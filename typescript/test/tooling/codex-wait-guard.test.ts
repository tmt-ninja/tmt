import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { writeExecutable } from '../support/executable-fixture.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

const script = fileURLToPath(
  new URL('../../../scripts/hooks/codex-wait-guard.mjs', import.meta.url)
);
const repository = fileURLToPath(new URL('../../..', import.meta.url));
const KEY = 'fake-key-for-tests';
const CACHE = `tmt-codex-wait-guard-${process.getuid?.() ?? 0}`;

let root: string;
let bin: string;
let server: Server;
let url: string;
/** What the fake judge answers next, and what it received. */
let answer: (request: IncomingMessage, response: ServerResponse) => void;
let received: {
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}[] = [];

beforeAll(async () => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'codex-wait-guard-')));
  bin = path.join(root, 'bin');
  mkdirSync(bin);
  // The seat lookup, so the test never asks the host's tmt.
  writeExecutable(path.join(bin, 'tmt'), '#!/bin/sh\necho \'{"name":"seat-1"}\'\n', 0o755);
  // The fake key source: never the host Keychain. It prints $HOME/keychain with the trailing
  // newline `security -w` adds, records its arguments, and otherwise fails like a missing item.
  writeExecutable(
    path.join(bin, 'security'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/security.log"
if [ -f "$HOME/keychain" ]; then cat "$HOME/keychain"; echo; exit 0; fi
echo "stderr-that-must-not-be-logged" >&2
exit 44
`,
    0o755
  );
  server = createServer((request, response) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => {
      received.push({ headers: request.headers, body: JSON.parse(text) });
      answer(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1/messages`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

const reply =
  (document: Record<string, unknown>, status = 200) =>
  (_: IncomingMessage, response: ServerResponse) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(document));
  };
const verdict = (value: string, reason = 'A reason.') =>
  reply({
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'verdict',
        input: { verdict: value, reason },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 120, output_tokens: 18 },
  });

type Run = {
  status: number | null;
  stdout: string;
  stderr: string;
  ms: number;
};

function newCase() {
  const dir = mkdtempSync(path.join(root, 'case-'));
  // The key cache lives under this case's own TMPDIR, never the host's.
  const tmp = path.join(dir, 'tmp');
  mkdirSync(tmp);
  writeFileSync(path.join(dir, 'keychain'), KEY);
  const logDir = path.join(dir, 'state', 'tmt');
  received = [];
  const run = (
    argv: string[],
    stdin: string,
    environment: Record<string, string> = {}
  ): Promise<Run> =>
    new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(process.execPath, argv, {
        env: {
          PATH: `${bin}${path.delimiter}/usr/bin:/bin`,
          HOME: dir,
          TMPDIR: tmp,
          TMT_WAIT_GUARD_URL: url,
          TMT_WAIT_GUARD_LOG_DIR: logDir,
          ...environment,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (status) => resolve({ status, stdout, stderr, ms: Date.now() - started }));
      child.stdin.end(stdin);
    });
  const guard = (
    payload: Record<string, unknown>,
    environment: Record<string, string> = {},
    hook = script
  ) =>
    run(
      [hook],
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'session-1',
        cwd: repository,
        ...payload,
      }),
      environment
    );
  const stats = (args: string[], environment: Record<string, string> = {}) =>
    run([script, 'stats', ...args], '', environment);
  const logText = () =>
    existsSync(logDir)
      ? readdirSync(logDir)
          .map((name) => readFileSync(path.join(logDir, name), 'utf8'))
          .join('')
      : '';
  const lines = () =>
    logText()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const cacheFile = path.join(tmp, CACHE, 'key');
  return { dir, logDir, cacheFile, guard, stats, lines, logText };
}

/** A scratch git repository holding a copy of the hook, for script files and the enforce flip. */
function scratchRepository(dir: string, source = readFileSync(script, 'utf8')) {
  const repo = path.join(dir, 'repo');
  mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  execFileSync('git', ['init', '-q', repo], {
    env: { PATH: '/usr/bin:/bin', HOME: dir },
  });
  const hook = path.join(repo, 'guard.mjs');
  writeFileSync(hook, source);
  return { repo, hook };
}

const bash = (command: string) => ({
  tool_name: 'Bash',
  tool_input: { command },
});
const sent = (index = 0) =>
  JSON.parse((received[index].body.messages as { content: string }[])[0].content);

describe('scripts/hooks/codex-wait-guard.mjs', () => {
  it('judges a call with a forced verdict and denies it', async () => {
    const c = newCase();
    answer = verdict('deny', 'Polls CI from the main session.');
    const result = await c.guard(bash('until gh pr checks 42; do sleep 60; done'));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(received).toHaveLength(1);
    expect(received[0].headers['x-api-key']).toBe(KEY);
    expect(received[0].body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      tool_choice: { type: 'tool', name: 'verdict' },
      thinking: { type: 'disabled' },
      tools: [expect.objectContaining({ name: 'verdict' })],
    });
    expect(sent()).toEqual({
      tool: 'Bash',
      input: 'until gh pr checks 42; do sleep 60; done',
    });
    const [line] = c.lines();
    expect(line).toMatchObject({
      session: 'session-1',
      tool: 'Bash',
      seat: 'seat-1',
      verdict: 'deny',
      enforced: true,
      reason: 'Polls CI from the main session.',
      inputTokens: 120,
      outputTokens: 18,
    });
    expect(typeof line.judgeMs).toBe('number');
    expect(typeof line.hookMs).toBe('number');
    // The log never holds the command, and nothing holds the key.
    expect(c.logText()).not.toContain('gh pr checks');
    expect(c.logText()).not.toContain(KEY);
    expect(result.stdout + result.stderr).not.toContain(KEY);
    const month = new Date().toISOString().slice(0, 7);
    expect(statSync(c.logDir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(c.logDir, `codex-wait-guard-${month}.jsonl`)).mode & 0o777).toBe(
      0o600
    );
  });

  it('names the fix in the deny, and only logs it once rolled back to shadow mode', async () => {
    const c = newCase();
    answer = verdict('deny', 'Polls CI from the main session.');
    const result = await c.guard(bash('gh pr checks 42 --watch'));
    const decision = JSON.parse(result.stdout).hookSpecificOutput;
    expect(decision).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });
    expect(decision.permissionDecisionReason).toContain('Polls CI from the main session.');
    // Codex seats start the waiter only this way (#6110): a detached start there exits 3.
    expect(decision.permissionDecisionReason).toContain(
      'scripts/ci-wake.sh <pr> --identity <self> --foreground inside a provider-native retained background task'
    );
    expect(decision.permissionDecisionReason).toContain('host-health.sh --gate');
    expect(c.lines()[0]).toMatchObject({ verdict: 'deny', enforced: true });

    const source = readFileSync(script, 'utf8').replace(
      'const ENFORCE = true;',
      'const ENFORCE = false;'
    );
    expect(source).toContain('const ENFORCE = false;');
    const { repo, hook } = scratchRepository(c.dir, source);
    const shadow = await c.guard({ ...bash('gh pr checks 42 --watch'), cwd: repo }, {}, hook);
    expect(shadow.stdout).toBe('');
    expect(c.lines().at(-1)).toMatchObject({ verdict: 'deny', enforced: false });
  });

  it('allows what the judge allows, printing nothing', async () => {
    const c = newCase();
    answer = verdict('allow', 'Builds the package.');
    const result = await c.guard(bash('timeout 600 cargo build -p tmt-digest'));
    expect(result.stdout).toBe('');
    expect(c.lines()[0]).toMatchObject({
      verdict: 'allow',
      reason: 'Builds the package.',
    });
  });

  it('skips the model only for the exact allowlist, and judges every near miss', async () => {
    const c = newCase();
    answer = () => {
      throw new Error('the judge must not be called');
    };
    const allowed = [
      bash('rg -n "sleep|wait" scripts'),
      bash('grep -rn untilDone src'),
      bash('ls'),
      bash('ls -la typescript'),
      bash('cat Cargo.toml'),
      bash('head -n 20 package.json'),
      bash('wc -l package.json'),
      bash('pwd'),
      bash('git status --short'),
      bash('git diff HEAD~1'),
      bash('git log --oneline -5'),
      bash('git show HEAD:package.json'),
      bash("sed -n '1,20p' package.json"),
      { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch' } },
      // One status read is not a wait; only repeating it is.
      bash('gh pr view 6041 --json state,mergedAt'),
      bash('gh pr checks 6041'),
      bash('gh issue view 6003 --comments'),
      bash('gh run view 123 --log-failed'),
      bash("gh api repos/tmt-ninja/tmt/pulls/6041 --jq '.head.sha'"),
      bash('gh api -X GET repos/tmt-ninja/tmt/issues/6003/comments'),
      // Writing a file from a quoted heredoc runs nothing, whatever the text says.
      bash("cat > notes.md <<'EOF'\nWaiting on CI: sleep 60 until green.\nEOF"),
      bash("cat <<'NOTES' >> state/notes.md\nline\nNOTES\n"),
    ];
    for (const payload of allowed) {
      const result = await c.guard(payload);
      expect(result.stdout, JSON.stringify(payload)).toBe('');
    }
    expect(received).toEqual([]);
    const lines = c.lines();
    expect(lines).toHaveLength(allowed.length);
    for (const line of lines) {
      expect(line).toMatchObject({ verdict: 'skip', session: 'session-1' });
      expect(typeof line.hookMs).toBe('number');
      expect(line).not.toHaveProperty('seat');
    }
    answer = verdict('allow');
    const nearMisses = [
      bash('cat x; sleep 5'),
      bash('rg x &'),
      bash('tail -f log'),
      bash('ls $(sleep 9)'),
      bash('cat `sleep 9`'),
      bash('cat a\nsleep 9'),
      bash('cat "$(sleep 9)"'),
      bash('gh pr checks 6041 --watch'),
      bash('gh run watch 123'),
      bash('gh pr view 6041 && sleep 60'),
      bash('cat > notes.md <<EOF\n$(sleep 9)\nEOF'),
      bash("cat > notes.md <<'EOF'\nx\nEOF\nsleep 60"),
      bash("cat > run.sh <<'EOF' && sh run.sh\nsleep 9\nEOF"),
      { tool_name: 'functions.wait', tool_input: { cell_id: '1' } },
      { tool_name: 'wait_agent', tool_input: { timeout_ms: 600000 } },
    ];
    for (const payload of nearMisses) await c.guard(payload);
    expect(received).toHaveLength(nearMisses.length);
    // Another tool is judged by its input.
    expect(sent(nearMisses.length - 1)).toEqual({
      tool: 'wait_agent',
      input: '{"timeout_ms":600000}',
    });
    // Outside the allowlist, a command with no wait primitive still skips the model.
    received = [];
    const noWait = ['git log && gh pr checks 1', 'cat', 'git push', 'sed -i s/a/b/ file', 'gh api'];
    for (const command of noWait) await c.guard(bash(command));
    expect(received).toEqual([]);
    for (const line of c.lines().slice(-noWait.length)) {
      expect(line).toMatchObject({ verdict: 'skip', reason: 'no-wait' });
    }
  });

  it("skips the model for starting this repository's ci-wake.sh, and judges anything around it", async () => {
    const c = newCase();
    answer = () => {
      throw new Error('the judge must not be called');
    };
    const waker = path.join(repository, 'scripts', 'ci-wake.sh');
    const starts = [
      'sh scripts/ci-wake.sh 6028 --identity infra-1',
      'bash scripts/ci-wake.sh 6028 --identity infra-1 --until merged',
      './scripts/ci-wake.sh 6028 --identity infra-1',
      `sh ${waker} 6028 --identity infra-1`,
      'sh scripts/ci-wake.sh 6028 --identity infra-1 &',
      'nohup sh scripts/ci-wake.sh 6028 --identity infra-1 > /tmp/ci-wake.log 2>&1 &',
      'sh scripts/ci-wake.sh 6028 --identity infra-1 < /dev/null >> "wake log.txt" 2>&1',
      // The Codex form (#6110), which the retained background task runs to completion.
      'sh scripts/ci-wake.sh 6028 --identity infra-1 --foreground',
      'sh scripts/ci-wake.sh 6028 --identity infra-1 --until merged --foreground',
      `sh ${waker} 6028 --identity infra-1 --foreground`,
    ];
    for (const command of starts) {
      const result = await c.guard(bash(command));
      expect(result.stdout, command).toBe('');
    }
    expect(received).toEqual([]);
    for (const line of c.lines()) {
      expect(line).toMatchObject({ verdict: 'skip', reason: 'ci-wake' });
    }

    const copy = path.join(c.dir, 'ci-wake.sh');
    writeFileSync(copy, readFileSync(waker));
    answer = verdict('deny', 'Waits in the main session.');
    const judged = [
      `sh ${copy} 6028 --identity infra-1`,
      'sh scripts/ci-wake.sh 6028 --identity infra-1; sleep 60',
      'while true; do sh scripts/ci-wake.sh 6028 --identity infra-1; done',
      'sh scripts/ci-wake.sh $(sleep 9)',
      'sleep 5 & sh scripts/ci-wake.sh 6028 --identity infra-1',
    ];
    for (const command of judged) await c.guard(bash(command));
    expect(received).toHaveLength(judged.length);
    // The policy names the waker as the allowed way to wait.
    expect(received[0].body.system).toContain(
      'Starting scripts/ci-wake.sh, or a provider background task that wakes the agent, is the allowed way to wait'
    );
    // A copy outside the worktree is read for its loop, and only its path and primitive are
    // sent. A single status read after the waker holds no wait primitive.
    expect(sent(0)).toMatchObject({ unsent: [{ path: copy, holds: expect.any(String) }] });
    expect(sent(0)).not.toHaveProperty('scripts');
    for (const command of ['sh scripts/ci-wake.sh 6028 --identity infra-1 && gh pr checks 6028']) {
      await c.guard(bash(command));
      expect(c.lines().at(-1), command).toMatchObject({ verdict: 'skip', reason: 'no-wait' });
    }
    expect(received).toHaveLength(judged.length);

    // A double-quoted redirect target that expands runs a command: never only a ci-wake start.
    const expanding = [
      'sh scripts/ci-wake.sh 6089 > "$(sleep 600)"',
      'sh scripts/ci-wake.sh 6089 > "$(sleep 600)" &',
      'sh scripts/ci-wake.sh 6089 > "`sleep 600`"',
      'sh scripts/ci-wake.sh 6089 > "`sleep 600`" &',
      'sh scripts/ci-wake.sh 6089 > "${HOME}/x.log"',
      'sh scripts/ci-wake.sh 6089 > "${HOME}/x.log" &',
    ];
    for (const command of expanding) {
      await c.guard(bash(command));
      expect(c.lines().at(-1).reason, command).not.toBe('ci-wake');
    }
    expect(received).toHaveLength(judged.length + expanding.length);
  });

  it("skips the model for another worktree's unmodified ci-wake.sh and a heredoc nothing runs (#6003)", async () => {
    const c = newCase();
    const { repo, hook } = scratchRepository(c.dir);
    const gitIn = (dir: string, ...args: string[]) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        env: { PATH: '/usr/bin:/bin', HOME: c.dir },
      });
    const waker = readFileSync(path.join(repository, 'scripts', 'ci-wake.sh'));
    writeFileSync(path.join(repo, 'scripts', 'ci-wake.sh'), waker);
    gitIn(repo, 'add', 'scripts/ci-wake.sh');
    gitIn(repo, 'commit', '-q', '-m', 'waker');
    const shared = path.join(c.dir, 'shared');
    gitIn(repo, 'worktree', 'add', '-q', '--detach', shared);
    const wake = `sh ${shared}/scripts/ci-wake.sh 6089 --identity infra-1`;
    answer = () => {
      throw new Error('the judge must not be called');
    };
    const skipped = [
      wake,
      `nohup ${wake} > /tmp/wake.log 2>&1 &`,
      // The two shadow-hour false denies: a waiter started first, then a push, PR and message;
      // and a handoff written from a quoted heredoc, a reply and an old waiter stopped first.
      `${wake} & git push -q origin HEAD && gh pr create --title x --body-file body.md && tmt talk lead "PR up, wait for review" --detach`,
      `cat > handoff.md <<'EOF'\nWaiting on CI until green.\nEOF\ntmt reply r --receipt v --message ok; pkill -f 'ci-wake.sh 6089'; ${wake}`,
      // The retained 03:31Z call: Python that stops an old waiter and writes notes whose
      // triple-quoted text says to wait, then a reply and the waiter.
      `python3 - <<'PY'\nimport os, signal\n# stop the superseded wait\nos.kill(73114, signal.SIGTERM)\nopen('notes.md', 'w').write('''CI waits only through ci-wake; do not wait in the session.''')\nPY\ntmt reply r --receipt v --message 'Intermediate wake stopped'\n${wake}`,
    ];
    for (const command of skipped) {
      const result = await c.guard({ ...bash(command), cwd: repo }, {}, hook);
      expect(result.stdout, command).toBe('');
    }
    expect(received).toEqual([]);
    expect(c.lines().map((line) => line.reason)).toEqual([
      'ci-wake',
      'ci-wake',
      'no-wait',
      'no-wait',
      'no-wait',
    ]);

    // A modified or untracked copy, the waker of another repository, and Python code that sleeps
    // are judged.
    const orphan = path.join(c.dir, 'orphan');
    gitIn(repo, 'worktree', 'add', '-q', '--detach', orphan);
    gitIn(orphan, 'checkout', '-q', '--orphan', 'empty');
    gitIn(orphan, 'rm', '-rq', '--cached', '.');
    gitIn(orphan, 'commit', '-q', '--allow-empty', '-m', 'empty');
    writeFileSync(path.join(orphan, 'scripts', 'ci-wake.sh'), waker);
    const elsewhere = path.join(c.dir, 'elsewhere');
    mkdirSync(path.join(elsewhere, 'scripts'), { recursive: true });
    gitIn(c.dir, 'init', '-q', elsewhere);
    writeFileSync(path.join(elsewhere, 'scripts', 'ci-wake.sh'), waker);
    gitIn(elsewhere, 'add', 'scripts/ci-wake.sh');
    gitIn(elsewhere, 'commit', '-q', '-m', 'waker');
    writeFileSync(path.join(shared, 'scripts', 'ci-wake.sh'), `${waker}\nsleep 600\n`);
    answer = verdict('allow');
    const judged = [
      wake,
      `sh ${orphan}/scripts/ci-wake.sh 6089 --identity infra-1`,
      `sh ${elsewhere}/scripts/ci-wake.sh 6089 --identity infra-1`,
      "python3 - <<'PY'\nimport time\ntime.sleep(60)\nPY",
      // A string handed to code that runs it stays code, triple-quoted or not.
      'python3 - <<\'PY\'\nimport subprocess\nsubprocess.run("sleep 60", shell=True)\nPY',
      'python3 - <<\'PY\'\nimport os\nos.system("sleep 5")\nPY',
      "python3 - <<'PY'\nimport subprocess\nsubprocess.run('''sleep 60''', shell=True)\nPY",
      "python3 - <<'PY'\nexec('''import time\ntime.sleep(5)''')\nPY",
      // On a continuation line inside the call, and a `#` inside a string, it is still code.
      'python3 - <<\'PY\'\nimport subprocess\nsubprocess.run(\n    """sleep 60""", shell=True)\nPY',
      "python3 - <<'PY'\nexec(\n'''import time\ntime.sleep(5)''')\nPY",
      'python3 - <<\'PY\'\nimport os\nos.system("echo #; sleep 5")\nPY',
    ];
    for (const command of judged) await c.guard({ ...bash(command), cwd: repo }, {}, hook);
    expect(received).toHaveLength(judged.length);
    // The judge writes its reason before its verdict, and the policy allows the waker beside
    // commands that do not wait.
    const tool = (received[0].body.tools as { input_schema: Record<string, unknown> }[])[0];
    expect(Object.keys(tool.input_schema.properties as object)).toEqual(['reason', 'verdict']);
    expect(tool.input_schema.required).toEqual(['reason', 'verdict']);
    expect(received[0].body.system).toContain(
      'A call that starts it and otherwise only runs commands that do not wait'
    );
  });

  it('skips the model for one run of a known test runner, and judges any watch, sleep or loop around it', async () => {
    const c = newCase();
    answer = () => {
      throw new Error('the judge must not be called');
    };
    const runs = [
      'pnpm test',
      'pnpm --filter tmt test',
      'npm run test',
      'npx vitest run test/tooling/ci-wake.test.ts',
      'npx playwright test acceptance/chrome.spec.ts',
      'corepack pnpm exec vp test run --config vitest.config.ts test/tooling/codex-wait-guard.test.ts',
      'vp test run',
      'pnpm exec playwright test',
      'cargo test -p tmt-ops --bin tmt-ops terminal_tab',
      'RUST_TEST_THREADS=3 cargo nextest run -p tmt-adapters',
      'cargo +stable test --offline --locked -p tmt-cli --test architecture',
      'node --test scripts/hooks/test.mjs',
    ];
    for (const command of runs) {
      const result = await c.guard(bash(command));
      expect(result.stdout, command).toBe('');
    }
    expect(received).toEqual([]);
    const lines = c.lines();
    expect(lines).toHaveLength(runs.length);
    for (const line of lines) expect(line).toMatchObject({ verdict: 'skip', reason: 'test' });

    answer = verdict('allow');
    const judged = [
      'npx vitest --watch',
      'pnpm exec vitest -w',
      'npx playwright test --ui',
      'cargo test && sleep 60',
      'while true; do pnpm test; done',
      'pnpm test &',
      'cargo watch -x test',
      'sleep 60 test',
      'pnpm test $(sleep 9)',
    ];
    for (const command of judged) await c.guard(bash(command));
    expect(received).toHaveLength(judged.length);
    for (const line of c.lines().slice(runs.length)) expect(line.verdict).toBe('allow');
    received = [];
    const noWait = [
      'pnpm test; gh pr checks 6041',
      'cargo test > log 2>&1',
      'npm run build',
      'node scripts/test.mjs',
      'pnpm exec tsx sleep.ts test',
    ];
    for (const command of noWait) await c.guard(bash(command));
    expect(received).toEqual([]);
    for (const line of c.lines().slice(-noWait.length)) {
      expect(line).toMatchObject({ verdict: 'skip', reason: 'no-wait' });
    }
  });

  it('judges a chain that ends by starting ci-wake.sh without that segment, and any other placement whole', async () => {
    const c = newCase();
    answer = verdict('allow');
    const wake = 'sh scripts/ci-wake.sh 6046 --identity infra-1';
    await c.guard(
      bash(
        `apply-edits && git commit -qam fix && timeout 60 git push -q && gh pr edit 6046 --body x && ${wake}`
      )
    );
    await c.guard(bash(`timeout 600 cargo build; ${wake} > /tmp/wake.log 2>&1 &`));
    expect(sent(0)).toEqual({
      tool: 'Bash',
      input:
        'apply-edits && git commit -qam fix && timeout 60 git push -q && gh pr edit 6046 --body x',
      next: 'the call then starts scripts/ci-wake.sh, which is allowed',
    });
    expect(sent(1)).toMatchObject({ input: 'timeout 600 cargo build' });
    // The waiter's own polling loop is not sent with the rest.
    expect(sent(0)).not.toHaveProperty('scripts');

    const whole = [
      `${wake} && sleep 60`,
      `while true; do git fetch; ${wake}; done`,
      `(timeout 60 git push && ${wake})`,
      `git push & ${wake}`,
      `for i in 1 2; do sleep 1; done; ${wake}`,
    ];
    for (const command of whole) await c.guard(bash(command));
    for (const [index, command] of whole.entries()) {
      expect(sent(index + 2), command).toEqual({
        tool: 'Bash',
        input: command,
        scripts: expect.anything(),
      });
    }
    const lines = c.lines();
    expect(lines.every((line) => line.verdict === 'allow')).toBe(true);
    // With no wait primitive around it, the waker's chain skips the model.
    received = [];
    for (const command of [
      `${wake}; gh pr checks 6046`,
      `(git push && ${wake})`,
      `git push || ${wake}`,
      `for i in 1 2; do git push; done; ${wake}`,
    ]) {
      await c.guard(bash(command));
      expect(c.lines().at(-1), command).toMatchObject({ verdict: 'skip', reason: 'no-wait' });
    }
    expect(received).toEqual([]);
  });

  it('skips the model for the shadow hour false denials and still judges a polling loop', async () => {
    const c = newCase();
    const { repo, hook } = scratchRepository(c.dir);
    writeFileSync(
      path.join(repo, 'scripts', 'publish.sh'),
      'gh pr comment "$1" --body-file report.md\ntmt talk lead "CI is green" --detach\n'
    );
    const unreadable = path.join(c.dir, 'missing', 'capture.sh');
    answer = () => {
      throw new Error('the judge must not be called');
    };
    // The shapes of the 11-05 shadow hour's false denials, with stand-in text.
    const shapes: [string, string][] = [
      // A long publish, comment and reply chain whose quoted text and heredoc mention waiting.
      [
        "git commit -qam 'docs: wait until green' && git push -q && gh pr comment 6060 --body-file - <<'EOF'\nGreen; I wait until the queue lands it.\nEOF\ntmt reply req_1 --receipt v2_x --message 'Ack. Waiting until merged.'",
        repository,
      ],
      // The same chain ending in a background ci-wake start.
      [
        'gh pr edit 6060 --body-file body.md && tmt talk lead "head green, wait for review" --detach && nohup sh scripts/ci-wake.sh 6060 --identity infra-1 > /tmp/wake.log 2>&1 &',
        repository,
      ],
      // A script the hook cannot read (here, missing) is judged by its command line only.
      [`sh ${unreadable} --out /tmp/capture.json`, repo],
      // A status read, then a repository script that only posts messages.
      ['gh pr checks 6060 && sh scripts/publish.sh 6060', repo],
    ];
    for (const [command, cwd] of shapes) {
      const result = await c.guard({ ...bash(command), cwd }, {}, cwd === repo ? hook : script);
      expect(result.stdout, command).toBe('');
      expect(c.lines().at(-1), command).toMatchObject({ verdict: 'skip', reason: 'no-wait' });
    }
    expect(received).toEqual([]);

    // The one true positive: a loop sleeping between status checks.
    answer = verdict('deny', 'Polls CI in a loop.');
    await c.guard(
      bash(
        'while ! gh api repos/tmt-ninja/tmt/commits/abc/status --jq .state | grep -q success; do sleep 30; done'
      )
    );
    expect(received).toHaveLength(1);
    expect(c.lines().at(-1)).toMatchObject({ verdict: 'deny', enforced: true });
    expect(received[0].body.system).toContain('Deny only when this call itself waits or polls');

    // The same loop written to a temporary file the seat owns, then run, still reaches the judge,
    // which learns the file's path and primitive but never its content.
    const loop = path.join(c.dir, 'tmp', 'x.sh');
    writeFileSync(loop, 'while :; do gh pr checks 6060; sleep 60; done\n');
    await c.guard({ ...bash(`sh ${loop}`), cwd: repo }, {}, hook);
    expect(received).toHaveLength(2);
    expect(sent(1)).toEqual({
      tool: 'Bash',
      input: `sh ${loop}`,
      unsent: [{ path: loop, holds: 'while' }],
    });
    expect(JSON.stringify(received[1].body)).not.toContain('gh pr checks 6060');
  });

  it('finds wait primitives in code the command runs, and none in quoted text', async () => {
    const { waitPrimitive } = await import(script);
    const waits: [string, string][] = [
      ['bash -c "sleep 5"', 'sleep'],
      ["python3 -c 'import time; time.sleep(5)'", 'sleep'],
      ["python3 - <<'EOF'\nimport time\ntime.sleep(3)\nEOF", 'sleep'],
      ["ssh host 'while true; do x; done'", 'while'],
      ['eval "sleep 1"', 'sleep'],
      ['cat "$(sleep 9)"', 'sleep'],
      ['tail -n 5 -F log', 'tail -f'],
      ['X=1 /bin/sleep 2', 'sleep'],
      ['npx vitest -w', '-w'],
      ['cargo build &', '&'],
      ['retry 3 gh pr checks 1', 'retry'],
    ];
    for (const [command, primitive] of waits) {
      expect(waitPrimitive(repository, command), command).toBe(primitive);
    }
    for (const command of [
      "grep -rn 'until' src",
      'git push 2>&1 | tail -3',
      'echo a &> /dev/null',
      'node scripts/hooks/missing.mjs # wait here',
      "tmt reply req_1 --receipt v2_x --message 'I wait until merged.'",
      "tmt reply req_1 --receipt v2_x --stdin <<'EOF'\nsleep well\nEOF",
    ]) {
      expect(waitPrimitive(repository, command), command).toBeNull();
    }
  });

  it('skips the model for the pinned host-health gate only, and judges anything else', async () => {
    const c = newCase();
    const gate = path.join(
      c.dir,
      '.config/tmt/notes/ada473fa-8c4d-4b12-9686-b44a77791a4b/host-health.sh'
    );
    mkdirSync(path.dirname(gate), { recursive: true });
    writeExecutable(gate, '#!/bin/sh\necho GO\n', 0o755);
    const pinned = execFileSync('shasum', ['-a', '256', gate], { encoding: 'utf8' }).split(' ')[0];
    const source = readFileSync(script, 'utf8').replace(
      /const HOST_HEALTH_SHA256 = '[0-9a-f]+';/,
      `const HOST_HEALTH_SHA256 = '${pinned}';`
    );
    const { repo, hook } = scratchRepository(c.dir, source);
    const guard = (command: string) => c.guard({ ...bash(command), cwd: repo }, {}, hook);
    answer = () => {
      throw new Error('the judge must not be called');
    };
    // The pin is the content: a byte-equal copy at any other path is the same gate.
    const copy = path.join(c.dir, 'elsewhere', 'host-health.sh');
    mkdirSync(path.dirname(copy), { recursive: true });
    writeExecutable(copy, readFileSync(gate, 'utf8'), 0o755);
    for (const command of [
      `${gate} --gate`,
      `sh ${gate} --gate`,
      `bash ${gate} --gate 2>&1`,
      `sh ${copy} --gate`,
    ]) {
      expect((await guard(command)).stdout, command).toBe('');
    }
    expect(received).toEqual([]);
    for (const line of c.lines()) {
      expect(line).toMatchObject({ verdict: 'skip', reason: 'host-health' });
    }

    answer = verdict('deny', 'Waits in the main session.');
    const changed = path.join(c.dir, 'changed', 'host-health.sh');
    mkdirSync(path.dirname(changed), { recursive: true });
    writeExecutable(changed, '#!/bin/sh\necho GO\nsleep 600\n', 0o755);
    // Other arguments leave the gate's skip; the gate's own content holds no wait primitive.
    for (const command of [`${gate} --gate-once`, `${gate} --gate --again`, `${gate}`]) {
      await guard(command);
      expect(c.lines().at(-1), command).toMatchObject({ verdict: 'skip', reason: 'no-wait' });
    }
    expect(received).toEqual([]);
    const judged = [
      `${gate} --gate; sleep 60`,
      `until ${gate} --gate; do sleep 60; done`,
      `sh ${changed} --gate`,
    ];
    for (const command of judged) await guard(command);
    expect(received).toHaveLength(judged.length);
    expect(received[0].body.system).toContain('One status read');
    expect(received[0].body.system).toContain('never deny because you cannot see it');
    // Any other content is judged, even at the pinned path.
    writeFileSync(gate, '#!/bin/sh\nsleep 600\n');
    await guard(`${gate} --gate`);
    expect(received).toHaveLength(judged.length + 1);
  });

  it('is inert outside this repository, and logs every call when switched off', async () => {
    const c = newCase();
    answer = verdict('deny');
    expect((await c.guard({ ...bash('sleep 600'), cwd: c.dir })).stdout).toBe('');
    expect(received).toEqual([]);
    expect(c.lines()).toEqual([]);
    const result = await c.guard(bash('sleep 600'), { TMT_WAIT_HOOK: 'off' });
    expect(result.stdout).toBe('');
    expect(received).toEqual([]);
    expect(c.lines()).toEqual([expect.objectContaining({ verdict: 'off' })]);
  });

  it('fails open with a distinct reason, keeping the tokens it got', async () => {
    const usage = { input_tokens: 300, output_tokens: 1024 };
    const cases: [
      string,
      (request: IncomingMessage, response: ServerResponse) => void,
      Record<string, string>,
    ][] = [
      ['no key', verdict('deny'), { NO_KEY: '1' }],
      ['http 500', reply({}, 500), {}],
      ['http 429', reply({}, 429), {}],
      ['max_tokens', reply({ content: [], stop_reason: 'max_tokens', usage }), {}],
      ['refusal', reply({ content: [], stop_reason: 'refusal', usage }), {}],
      ['parse', reply({ content: [{ type: 'text', text: 'allow' }], usage }), {}],
      [
        'parse',
        (_, response) => {
          response.writeHead(200);
          response.end('not json');
        },
        {},
      ],
      [
        'bad verdict',
        reply({
          content: [{ type: 'tool_use', name: 'verdict', input: { verdict: 'maybe' } }],
          usage,
        }),
        {},
      ],
      ['network', verdict('deny'), { TMT_WAIT_GUARD_URL: 'http://127.0.0.1:9/v1/messages' }],
      ['timeout', () => {}, {}],
    ];
    for (const [reason, respond, environment] of cases) {
      const c = newCase();
      if (environment.NO_KEY) rmSync(path.join(c.dir, 'keychain'));
      answer = respond;
      const result = await c.guard(
        bash('while true; do gh run view 1; sleep 30; done'),
        environment
      );
      expect(result.stdout, reason).toBe('');
      const [line] = c.lines();
      expect(line, reason).toMatchObject({ verdict: 'fail_open', reason });
      if (['max_tokens', 'refusal', 'bad verdict'].includes(reason)) {
        expect(line, reason).toMatchObject({
          inputTokens: 300,
          outputTokens: 1024,
        });
      }
      if (reason === 'no key') {
        expect(received).toEqual([]);
        expect(c.logText()).not.toContain('stderr-that-must-not-be-logged');
      }
      // The judge's budget is 3.5 s; the seat lookup runs alongside it.
      expect(result.ms, reason).toBeLessThan(4_800);
    }
  });

  it('never sends the key to a judge override off loopback', async () => {
    for (const override of [
      'https://judge.example.com/v1/messages',
      'http://10.0.0.1/v1',
      'not a url',
    ]) {
      const c = newCase();
      answer = verdict('deny');
      const result = await c.guard(bash('sleep 600'), {
        TMT_WAIT_GUARD_URL: override,
      });
      expect(result.stdout, override).toBe('');
      expect(c.lines(), override).toEqual([
        expect.objectContaining({
          verdict: 'fail_open',
          reason: 'untrusted judge url',
        }),
      ]);
      // The key is not even read for a foreign endpoint.
      expect(existsSync(path.join(c.dir, 'security.log')), override).toBe(false);
    }
  });

  it('caches the key privately, and re-reads the Keychain once on a 401', async () => {
    const c = newCase();
    answer = verdict('allow');
    await c.guard(bash('timeout 60 make build'));
    await c.guard(bash('timeout 60 make build'));
    // One Keychain read, with `security -w`'s trailing newline trimmed, then the cache.
    expect(readFileSync(path.join(c.dir, 'security.log'), 'utf8')).toBe(
      'find-generic-password -s tmt-codex-hook-anthropic -w\n'
    );
    expect(readFileSync(c.cacheFile, 'utf8')).toBe(KEY);
    expect(statSync(path.dirname(c.cacheFile)).mode & 0o777).toBe(0o700);
    expect(statSync(c.cacheFile).mode & 0o777).toBe(0o600);
    expect(readdirSync(path.dirname(c.cacheFile))).toEqual(['key']);

    // A stale cached key gets a 401: the cache is dropped, the Keychain read once, one retry.
    writeFileSync(c.cacheFile, 'stale-key', { mode: 0o600 });
    received = [];
    answer = (request, response) =>
      (request.headers['x-api-key'] === KEY ? verdict('allow') : reply({}, 401))(request, response);
    await c.guard(bash('timeout 60 make build'));
    expect(received.map((request) => request.headers['x-api-key'])).toEqual(['stale-key', KEY]);
    expect(readFileSync(c.cacheFile, 'utf8')).toBe(KEY);
    expect(c.lines().at(-1)).toMatchObject({ verdict: 'allow' });

    // A key the Keychain itself gives is not retried again.
    received = [];
    answer = reply({}, 403);
    await c.guard(bash('timeout 60 make build'));
    expect(received).toHaveLength(2);
    expect(c.lines().at(-1)).toMatchObject({
      verdict: 'fail_open',
      reason: 'http 403',
    });

    // A cache readable by others is ignored and rewritten.
    writeFileSync(c.cacheFile, 'leaked');
    chmodSync(c.cacheFile, 0o644);
    received = [];
    answer = verdict('allow');
    await c.guard(bash('timeout 60 make build'));
    expect(received[0].headers['x-api-key']).toBe(KEY);
    expect(statSync(c.cacheFile).mode & 0o777).toBe(0o600);
    expect(c.logText()).not.toContain(KEY);
  });

  it('denies every spelling of the key cache in every mode, without asking the judge', async () => {
    const c = newCase();
    answer = verdict('allow');
    await c.guard(bash('timeout 60 make build'));
    const cacheDir = path.dirname(c.cacheFile);
    symlinkSync(cacheDir, path.join(c.dir, 'innocent'));
    const { repo, hook } = scratchRepository(c.dir);
    writeFileSync(path.join(repo, 'scripts', 'peek.sh'), `cat "$TMPDIR/${CACHE}/key"\n`);
    received = [];
    // The temporary directory with two of its parents' names globbed, like /var/folders/*/*/T/*.
    const parts = path.dirname(c.cacheFile).split(path.sep).slice(0, -1);
    const parentsGlob = [...parts.slice(0, -3), '*', '*', parts.at(-1), '*'].join(path.sep);
    const spellings: [Record<string, unknown>, string, string][] = [
      [bash(`cat $TMPDIR/${CACHE}/key`), repository, script],
      [bash('cat "${TMPDIR}"tmt-codex-wait-guard-*/key'), repository, script],
      [bash('cat $TMPDIR/tmt-codex-*/key'), repository, script],
      [bash('ls $TMPDIR/*'), repository, script],
      [bash(`cat ${parentsGlob}/key`), repository, script],
      [bash(`realpath ${path.join(c.dir, 'innocent')}/key`), repository, script],
      [{ tool_name: 'apply_patch', tool_input: { command: `cat ${CACHE}` } }, repository, script],
      [
        {
          tool_name: 'read_file',
          tool_input: { path: path.join(c.dir, 'innocent', 'key') },
        },
        repository,
        script,
      ],
      [bash('sh scripts/peek.sh'), repo, hook],
      [bash('./scripts/peek.sh'), repo, hook],
    ];
    for (const [payload, cwd, guardScript] of spellings) {
      const result = await c.guard({ ...payload, cwd }, {}, guardScript);
      const decision = JSON.parse(result.stdout).hookSpecificOutput;
      expect(decision.permissionDecision, JSON.stringify(payload)).toBe('deny');
    }
    expect(received).toEqual([]);
    const lines = c.lines().slice(1);
    expect(lines).toHaveLength(spellings.length);
    for (const line of lines) {
      expect(line).toMatchObject({
        verdict: 'deny',
        enforced: true,
        reason: 'key cache',
      });
    }
    // Ordinary temp-directory work, and this hook's own source, are not mistaken for the cache.
    answer = verdict('allow');
    await c.guard(bash('ls $TMPDIR/*.log'));
    await c.guard(bash('node scripts/hooks/codex-wait-guard.mjs stats'));
    expect(c.lines().slice(-2)).toEqual([
      expect.objectContaining({ verdict: 'skip', reason: 'no-wait' }),
      expect.objectContaining({ verdict: 'allow' }),
    ]);
    // A glob under an unrelated directory cannot reach the cache: the 11-05 gui-3 shape (a brace
    // group and a trailing `*` under a worktree in /private/tmp), and a `*` under the repository.
    for (const command of [
      'ls -ld /private/tmp/gui-3-blocks/wt/typescript/{colab-client,node_modules}/*',
      `ls ${path.join(repository, 'typescript')}/*`,
    ]) {
      const result = await c.guard(bash(command));
      expect(result.stdout, command).toBe('');
      expect(c.lines().at(-1), command).toMatchObject({ verdict: 'skip' });
    }
  });

  it('sends redacted, capped input and repository scripts, never files outside the worktree', async () => {
    const c = newCase();
    answer = verdict('allow');
    const secrets = [
      'abc123secret',
      'sk-ant-api03-aaaaaaaaaaaaaaaaaaaa',
      'pass-in-url',
      'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'github_pat_bbbbbbbbbbbbbbbbbbbbbbbb',
      'xoxb-1234567890-abcdef',
      'AKIAABCDEFGHIJKLMNOP',
      'env-value',
      'flag-value',
      'json-value',
    ];
    const command = [
      `curl -H "Authorization: Bearer ${secrets[0]}" -H 'x-api-key: ${secrets[1]}' https://ben:${secrets[2]}@example.com/x`,
      `GITHUB_TOKEN=${secrets[3]} gh api user`,
      `echo ${secrets[4]} ${secrets[5]} ${secrets[6]}`,
      `MY_SECRET="${secrets[7]}" tool --api-key ${secrets[8]} '{"client_secret":"${secrets[9]}"}'`,
      'sleep 1',
    ].join('; ');
    await c.guard(bash(command));
    const input = sent().input as string;
    for (const secret of secrets) expect(input, secret).not.toContain(secret);
    expect(input).toContain('[REDACTED]');
    expect(input).toContain('gh api user');

    received = [];
    await c.guard(bash(`sleep 1; ${'x'.repeat(20_000)}`));
    expect(sent().input).toHaveLength(8_000);

    const { repo, hook } = scratchRepository(c.dir);
    writeFileSync(
      path.join(repo, 'scripts', 'watch-ci.py'),
      `import time\nTOKEN="${secrets[3]}"\nwhile True:\n    time.sleep(60)\n`
    );
    writeFileSync(path.join(c.dir, 'outside.sh'), 'echo outside-content\n');
    symlinkSync(path.join(c.dir, 'outside.sh'), path.join(repo, 'scripts', 'link.sh'));
    received = [];
    await c.guard(
      {
        ...bash('python3 scripts/watch-ci.py && sh scripts/link.sh'),
        cwd: repo,
      },
      {},
      hook
    );
    expect(sent().scripts).toEqual([
      {
        path: 'scripts/watch-ci.py',
        content: 'import time\nTOKEN=[REDACTED]\nwhile True:\n    time.sleep(60)\n',
      },
    ]);
    expect(JSON.stringify(received[0].body)).not.toContain('outside-content');

    // A heredoc write skips the model, but running what it wrote is judged with its content.
    const loop = 'while :; do gh pr checks 6041; sleep 60; done';
    received = [];
    answer = () => {
      throw new Error('the judge must not be called for the write');
    };
    const write = `cat > scripts/wait-ci.sh <<'EOF'\n${loop}\nEOF`;
    await c.guard({ ...bash(write), cwd: repo }, {}, hook);
    expect(received).toEqual([]);
    expect(c.lines().at(-1)).toMatchObject({ verdict: 'skip' });
    // The seat's shell writes the file; the hook only judged the call.
    writeFileSync(path.join(repo, 'scripts', 'wait-ci.sh'), `${loop}\n`);
    answer = verdict('deny', 'Runs a CI polling loop.');
    await c.guard({ ...bash('sh scripts/wait-ci.sh'), cwd: repo }, {}, hook);
    expect(sent().scripts).toEqual([{ path: 'scripts/wait-ci.sh', content: `${loop}\n` }]);
    expect(c.lines().at(-1)).toMatchObject({ verdict: 'deny', enforced: true });
  });

  it('summarizes the log over a window with the denominator, timings and cost', async () => {
    const c = newCase();
    mkdirSync(c.logDir, { recursive: true });
    const line = (at: string, entry: Record<string, unknown>) => JSON.stringify({ at, ...entry });
    writeFileSync(
      path.join(c.logDir, 'codex-wait-guard-2026-11.jsonl'),
      [
        line('2026-11-03T10:00:00.000Z', {
          session: 's1',
          verdict: 'skip',
          hookMs: 40,
        }),
        line('2026-11-03T10:01:00.000Z', {
          session: 's1',
          seat: 'gui-3',
          verdict: 'allow',
          judgeMs: 1000,
          hookMs: 1100,
          inputTokens: 1_000_000,
          outputTokens: 100_000,
        }),
        line('2026-11-03T11:00:00.000Z', {
          session: 's2',
          seat: 'night-1',
          verdict: 'deny',
          enforced: false,
          judgeMs: 2000,
          hookMs: 2100,
        }),
        line('2026-11-04T09:00:00.000Z', {
          session: 's2',
          verdict: 'fail_open',
          reason: 'timeout',
          judgeMs: 3500,
          hookMs: 3600,
        }),
        line('2026-11-04T09:30:00.000Z', {
          session: 's3',
          verdict: 'deny',
          enforced: true,
        }),
        line('2026-11-04T09:40:00.000Z', { session: 's3', verdict: 'off' }),
        // At the window's edge, and just outside it.
        line('2026-11-02T12:00:00.000Z', { session: 's4', verdict: 'skip' }),
        line('2026-11-02T11:59:59.999Z', { session: 's4', verdict: 'skip' }),
        '{"at": "broken',
        '{"verdict":"allow"}',
      ].join('\n') + '\n'
    );
    // The log file from before #6003, where the judge's time was latencyMs.
    writeFileSync(
      path.join(c.logDir, 'codex-wait-guard.jsonl'),
      `${line('2026-11-03T02:01:00.000Z', { seat: 'gui-2', prefilter: true, verdict: 'fail_open', reason: 'error', latencyMs: 1200 })}\n`
    );
    const now = { TMT_WAIT_GUARD_NOW: '2026-11-04T12:00:00.000Z' };
    const result = await c.stats(['--since', '48h', '--json'], now);
    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      from: '2026-11-02T12:00:00.000Z',
      to: '2026-11-04T12:00:00.000Z',
      corrupt: 2,
      total: {
        calls: 8,
        skip: 2,
        allow: 1,
        deny: 1,
        shadowDeny: 1,
        failOpen: 2,
        off: 1,
      },
      failOpenReasons: { timeout: 1, error: 1 },
      judgeMs: { p50: 1200, p95: 3500 },
      hookMs: { p50: 1100, p95: 3600 },
      tokens: { input: 1_000_000, output: 100_000 },
      // $0.10 per million in and $0.50 per million out, over two days.
      costUsd: 0.15,
      costUsdPerDay: 0.075,
      budgetUsdPerMonth: 200,
    });
    expect(summary.byDay['2026-11-03'].calls).toBe(4);
    expect(summary.byDay['2026-11-04'].calls).toBe(3);
    // A seat is joined to the calls of its session that did not name it.
    expect(summary.bySeat['gui-3']).toMatchObject({
      calls: 2,
      skip: 1,
      allow: 1,
    });
    expect(summary.bySeat['night-1']).toMatchObject({
      calls: 2,
      shadowDeny: 1,
      failOpen: 1,
    });
    expect(summary.bySeat.unknown.calls).toBe(3);

    const text = await c.stats(['--since', '1d'], now);
    expect(text.stdout).toContain('calls 3 ·');
    expect(text.stdout).toContain('2 unreadable lines skipped');

    const empty = newCase();
    const none = JSON.parse((await empty.stats(['--json'])).stdout);
    expect(none.total.calls).toBe(0);
    expect(none.judgeMs).toEqual({ p50: null, p95: null });

    for (const args of [['--since', '0h'], ['--since', '3w'], ['--since'], ['--bogus']]) {
      const bad = await c.stats(args);
      expect(bad.status, args.join(' ')).toBe(2);
      expect(bad.stderr).toContain('usage:');
    }
  });
});
