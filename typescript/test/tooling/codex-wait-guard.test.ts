import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { writeExecutable } from '../support/executable-fixture.mjs';
import { spawn } from 'node:child_process';
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

let root: string;
let bin: string;
let server: Server;
let url: string;
/** What the fake judge answers next, and what it received. */
let answer: (request: IncomingMessage, response: ServerResponse) => void;
let received: { headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'codex-wait-guard-'));
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

const verdict = (text: string) => (_: IncomingMessage, response: ServerResponse) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 120, output_tokens: 18 },
    })
  );
};

function newCase() {
  const dir = mkdtempSync(path.join(root, 'case-'));
  writeFileSync(path.join(dir, 'keychain'), KEY);
  const logFile = path.join(dir, 'state', 'tmt', 'codex-wait-guard.jsonl');
  received = [];
  const guard = (
    payload: Record<string, unknown>,
    environment: Record<string, string> = {}
  ): Promise<{ status: number | null; stdout: string; stderr: string; ms: number }> =>
    new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(process.execPath, [script], {
        env: {
          PATH: `${bin}${path.delimiter}/usr/bin:/bin`,
          HOME: dir,
          TMT_WAIT_GUARD_URL: url,
          TMT_WAIT_GUARD_LOG: logFile,
          ...environment,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (status) => resolve({ status, stdout, stderr, ms: Date.now() - started }));
      child.stdin.end(
        JSON.stringify({ hook_event_name: 'PreToolUse', cwd: repository, ...payload })
      );
    });
  const lines = () =>
    existsSync(logFile)
      ? readFileSync(logFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  return { dir, logFile, guard, lines };
}

const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });

describe('scripts/hooks/codex-wait-guard.mjs', () => {
  it('denies a CI poll the judge calls a wait, and logs the verdict without the key', async () => {
    const c = newCase();
    answer = verdict('{"verdict":"deny","reason":"Polls CI from the main session."}');
    const result = await c.guard(bash('until gh pr checks 42; do sleep 60; done'));
    expect(result.status).toBe(0);
    const decision = JSON.parse(result.stdout).hookSpecificOutput;
    expect(decision.hookEventName).toBe('PreToolUse');
    expect(decision.permissionDecision).toBe('deny');
    expect(decision.permissionDecisionReason).toContain('Polls CI from the main session.');
    expect(decision.permissionDecisionReason).toContain('scripts/ci-wake.sh');
    // One request: the model, the key header, and only the tool name and command.
    expect(received).toHaveLength(1);
    // The Keychain item, read once, with `security -w`'s trailing newline trimmed.
    expect(readFileSync(path.join(c.dir, 'security.log'), 'utf8')).toBe(
      'find-generic-password -s tmt-codex-hook-anthropic -w\n'
    );
    expect(received[0].headers['x-api-key']).toBe(KEY);
    expect(received[0].body.model).toBe('claude-haiku-5-5');
    expect(received[0].body.messages).toEqual([
      {
        role: 'user',
        content: JSON.stringify({
          tool: 'Bash',
          command: 'until gh pr checks 42; do sleep 60; done',
        }),
      },
    ]);
    const [line] = c.lines();
    expect(line).toMatchObject({
      tool: 'Bash',
      seat: 'seat-1',
      prefilter: true,
      verdict: 'deny',
      reason: 'Polls CI from the main session.',
      inputTokens: 120,
      outputTokens: 18,
    });
    expect(typeof line.latencyMs).toBe('number');
    expect(readFileSync(c.logFile, 'utf8')).not.toContain(KEY);
    expect(result.stdout + result.stderr).not.toContain(KEY);
    expect(statSync(path.dirname(c.logFile)).mode & 0o777).toBe(0o700);
    expect(statSync(c.logFile).mode & 0o777).toBe(0o600);
  });

  it('allows what the judge allows, printing nothing', async () => {
    const c = newCase();
    answer = verdict('Sure: {"verdict":"allow","reason":"Waits two seconds for a local server."}');
    const result = await c.guard(bash('sleep 2 && curl -s localhost:5100'));
    expect(result.stdout).toBe('');
    expect(c.lines()[0]).toMatchObject({ verdict: 'allow' });
  });

  it('judges the namespaced wait tools Codex reports', async () => {
    for (const tool of ['clocksleep', 'collaborationwait_agent', 'wait_agent']) {
      const c = newCase();
      answer = verdict('{"verdict":"deny","reason":"Waits on an agent."}');
      const result = await c.guard({ tool_name: tool, tool_input: { timeout_ms: 600000 } });
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, tool).toBe('deny');
      expect(received, tool).toHaveLength(1);
      // Another tool is judged by its input, such as how long it waits.
      expect(JSON.parse((received[0].body.messages as { content: string }[])[0].content)).toEqual({
        tool,
        command: '{"timeout_ms":600000}',
      });
    }
  });

  it('allows anything that is not wait-shaped with no request and no log line', async () => {
    const c = newCase();
    answer = () => {
      throw new Error('the judge must not be called');
    };
    for (const payload of [
      bash('cargo test -p tmt-digest'),
      bash('gh pr view 42 --json title'),
      bash('echo asleep; grep -r untilDone src'),
      { tool_name: 'apply_patch', tool_input: { command: 'sleep 9' } },
      { tool_name: 'functions.wait', tool_input: { cell_id: '1' } },
    ]) {
      const result = await c.guard(payload);
      expect(result.stdout, JSON.stringify(payload)).toBe('');
    }
    expect(received).toEqual([]);
    expect(existsSync(c.logFile)).toBe(false);
  });

  it('allows outside this repository, so a global wiring is inert elsewhere', async () => {
    const c = newCase();
    answer = verdict('{"verdict":"deny","reason":"x"}');
    const result = await c.guard({ ...bash('sleep 600'), cwd: c.dir });
    expect(result.stdout).toBe('');
    expect(received).toEqual([]);
    expect(c.lines()).toEqual([]);
  });

  it('is switched off per seat, and logs the wait it let through', async () => {
    const c = newCase();
    answer = verdict('{"verdict":"deny","reason":"x"}');
    const result = await c.guard(bash('sleep 600'), { TMT_WAIT_HOOK: 'off' });
    expect(result.stdout).toBe('');
    expect(received).toEqual([]);
    expect(c.lines()).toEqual([expect.objectContaining({ verdict: 'off', prefilter: true })]);
  });

  it('fails open, with the reason logged, on a missing key, an error, garbage or a timeout', async () => {
    const cases: [
      string,
      (request: IncomingMessage, response: ServerResponse) => void,
      Record<string, string>,
    ][] = [
      ['no key', verdict('{"verdict":"deny","reason":"x"}'), { NO_KEY: '1' }],
      [
        'http 500',
        (_, response) => {
          response.writeHead(500);
          response.end('{}');
        },
        {},
      ],
      ['unreadable verdict', verdict('{"verdict":"maybe"}'), {}],
      ['error', verdict('no json here'), {}],
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
      expect(c.lines(), reason).toEqual([
        expect.objectContaining({ verdict: 'fail_open', reason }),
      ]);
      if (reason === 'no key') {
        expect(received).toEqual([]);
        expect(readFileSync(c.logFile, 'utf8')).not.toContain('stderr-that-must-not-be-logged');
      }
      // The judge's budget is 2 s; the seat lookup runs after it with its own short limit.
      expect(result.ms, reason).toBeLessThan(4_000);
    }
  });

  it('never sends the key to a judge override off loopback', async () => {
    for (const override of [
      'https://judge.example.com/v1/messages',
      'http://10.0.0.1/v1',
      'not a url',
    ]) {
      const c = newCase();
      answer = verdict('{"verdict":"deny","reason":"x"}');
      const result = await c.guard(bash('sleep 600'), { TMT_WAIT_GUARD_URL: override });
      expect(result.stdout, override).toBe('');
      expect(c.lines(), override).toEqual([
        expect.objectContaining({ verdict: 'fail_open', reason: 'untrusted judge url' }),
      ]);
      // The key is not even read for a foreign endpoint.
      expect(existsSync(path.join(c.dir, 'security.log')), override).toBe(false);
    }
  });

  it('caps the command at 2000 characters for the judge and 300 in the log', async () => {
    const c = newCase();
    answer = verdict('{"verdict":"allow","reason":"ok"}');
    const long = `sleep 1; ${'x'.repeat(5_000)}`;
    await c.guard(bash(long));
    const sent = JSON.parse((received[0].body.messages as { content: string }[])[0].content);
    expect(sent.command).toHaveLength(2_000);
    expect(c.lines()[0].command).toHaveLength(300);
  });
});
