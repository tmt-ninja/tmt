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
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

const script = fileURLToPath(new URL('../../../scripts/ci-wake.sh', import.meta.url));
const HEAD = 'a'.repeat(40);

let root: string;
let bin: string;

/**
 * The fake tools keep their state and switches under $HOME, one of the few
 * variables the script's anonymous send keeps, so each case is a private HOME.
 */
beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'ci-wake-'));
  bin = path.join(root, 'bin');
  mkdirSync(bin);
  const tool = (name: string, body: string) => {
    writeExecutable(path.join(bin, name), `#!/bin/sh\n${body}\n`, 0o755);
  };
  // The PR read answers line N of $HOME/pulls on its Nth call, then repeats the
  // last line; workflow runs, check runs and statuses answer $HOME/workflows,
  // $HOME/runs and $HOME/statuses.
  tool(
    'gh',
    `echo "$*" >> "$HOME/gh.log"
case $* in
  */pulls/*)
    echo x >> "$HOME/pull-count"
    n=$(wc -l < "$HOME/pull-count" | tr -d ' ')
    total=$(wc -l < "$HOME/pulls" | tr -d ' ')
    [ "$n" -le "$total" ] || n=$total
    sed -n "\${n}p" "$HOME/pulls" ;;
  */actions/runs*) cat "$HOME/workflows" 2>/dev/null ;;
  */check-runs*) cat "$HOME/runs" 2>/dev/null ;;
  */status*) cat "$HOME/statuses" 2>/dev/null ;;
esac`
  );
  // Records each send with whether a caller identity could be inferred.
  tool(
    'tmt',
    `case $1 in
  identity) [ ! -f "$HOME/no-identity" ] || exit 3 ;;
  talk)
    printf '%s|pane=%s|tmux=%s\\n' "$*" "\${TMUX_PANE-unset}" "\${TMUX-unset}" >> "$HOME/talk.log"
    [ ! -f "$HOME/talk-fails" ] || exit 1 ;;
esac`
  );
  tool('nap', 'echo "$*" >> "$HOME/sleeps.log"; [ -z "$REAL_NAP" ] || /bin/sleep 1');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function newCase(pulls: string[], files: Record<string, string> = {}) {
  const home = mkdtempSync(path.join(root, 'case-'));
  writeFileSync(path.join(home, 'pulls'), `${pulls.join('\n')}\n`);
  // One completed workflow run unless a case says otherwise.
  writeFileSync(path.join(home, 'workflows'), 'completed\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(home, name), text);
  const lines = (name: string) => {
    const file = path.join(home, name);
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').slice(0, -1) : [];
  };
  const run = (args: string[], environment: Record<string, string> = {}) => {
    const result = spawnSync('/bin/sh', [script, ...args], {
      env: {
        PATH: `${bin}${path.delimiter}/usr/bin:/bin`,
        HOME: home,
        TMPDIR: `${home}/`,
        CI_WAKE_SLEEP: 'nap',
        TMUX: '/tmp/tmux-501/default,1,0',
        TMUX_PANE: '%1',
        ...environment,
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  // The waiting process, run in the foreground with a log it may remove.
  const wait = (extra: string[] = [], environment: Record<string, string> = {}) => {
    const log = path.join(home, 'wait.log');
    writeFileSync(log, '');
    const result = run(['__run', '42', '--identity', 'core-ops', ...extra], {
      CI_WAKE_LOG: log,
      ...environment,
    });
    return { ...result, log };
  };
  return { home, lines, run, wait };
}

const open = `open false ${HEAD}`;
const tsv = (...rows: string[][]) => rows.map((row) => `${row.join('\t')}\n`).join('');
let nextId = 1;
/** A check run as the API's `--jq` projection prints it: name, ID, status, conclusion. */
const check = (status: string, conclusion: string, name: string, id = nextId++) => [
  name,
  String(id),
  status,
  conclusion,
];

describe('scripts/ci-wake.sh', () => {
  it('wakes the seat once, anonymously and urgently, when every check is green', () => {
    const c = newCase([open, open, open], {
      runs: tsv(check('completed', 'success', 'rust'), check('completed', 'skipped', 'docs')),
      statuses: tsv(['success', 'ci/legacy']),
    });
    const result = c.wait();
    expect(result.status).toBe(0);
    const talks = c.lines('talk.log');
    expect(talks).toHaveLength(1);
    expect(talks[0]).toBe(
      'talk core-ops ci-wake #42 aaaaaaaaaaaa: green (3 checks) --detach --urgent --kind fyi|pane=unset|tmux=unset'
    );
    expect(talks[0]).not.toContain('--identity');
    // Delivered, so nothing is left behind, and GitHub was read only by REST.
    expect(existsSync(result.log)).toBe(false);
    expect(c.lines('gh.log').every((line) => line.startsWith('api '))).toBe(true);
    expect(c.lines('gh.log').join('\n')).not.toContain('graphql');
    expect(c.lines('sleeps.log')).toEqual([]);
  });

  it('names the failed checks once the last one completes', () => {
    const c = newCase([open], {
      runs: tsv(
        check('completed', 'failure', 'rust (linux)'),
        check('completed', 'success', 'docs'),
        check('completed', 'timed_out', 'e2e')
      ),
      statuses: tsv(['error', 'ci/legacy']),
    });
    expect(c.wait().status).toBe(0);
    expect(c.lines('talk.log')[0]).toContain(': failed: ci/legacy, e2e, rust (linux) --detach');
  });

  it('counts only the newest run of a check that was rerun', () => {
    const c = newCase([open], {
      runs: tsv(
        check('completed', 'success', 'title', 30),
        check('completed', 'cancelled', 'title', 10),
        check('completed', 'success', 'rust', 20)
      ),
    });
    expect(c.wait().status).toBe(0);
    expect(c.lines('talk.log')[0]).toContain(': green (2 checks) --detach');
  });

  it('keeps polling at the interval plus jitter while a check is pending', () => {
    const c = newCase([open], {
      runs: tsv(check('in_progress', '', 'rust'), check('completed', 'success', 'docs')),
    });
    // The pending poll repeats until the cap; one real second ends it.
    const result = c.wait(['--interval', '200', '--cap', '1'], { REAL_NAP: '1' });
    expect(result.status).toBe(0);
    const sleeps = c.lines('sleeps.log').map(Number);
    expect(sleeps.length).toBeGreaterThan(0);
    for (const sleep of sleeps) {
      expect(sleep).toBeGreaterThanOrEqual(200);
      expect(sleep).toBeLessThanOrEqual(230);
    }
    expect(c.lines('talk.log')).toHaveLength(1);
    expect(c.lines('talk.log')[0]).toContain(': no final state after 0 min; this wait ended');
  });

  it('waits while a workflow run is still going, though every check so far is green', () => {
    const c = newCase([open], {
      runs: tsv(check('completed', 'success', 'early')),
      workflows: 'completed\nin_progress\n',
    });
    const result = c.wait(['--cap', '1'], { REAL_NAP: '1' });
    expect(result.status).toBe(0);
    expect(c.lines('talk.log')).toEqual([expect.stringContaining(': no final state after 0 min')]);
    expect(c.lines('gh.log').join('\n')).toContain(`actions/runs?head_sha=${HEAD}&per_page=100`);
  });

  it('does not report green before any workflow run exists for the head', () => {
    const c = newCase([open], { runs: tsv(check('completed', 'success', 'early')), workflows: '' });
    const result = c.wait(['--cap', '1'], { REAL_NAP: '1' });
    expect(result.status).toBe(0);
    expect(c.lines('talk.log')[0]).toContain('no final state');
  });

  it('does not report green before any check has started', () => {
    const c = newCase([open]);
    const result = c.wait(['--cap', '1'], { REAL_NAP: '1' });
    expect(result.status).toBe(0);
    expect(c.lines('talk.log')[0]).toContain('no final state');
  });

  it('ends the wait when the PR merges, closes or gets a new head', () => {
    const merged = newCase([open, `closed true ${HEAD}`]);
    expect(merged.wait(['--until', 'merged']).status).toBe(0);
    expect(merged.lines('talk.log')[0]).toContain(': merged --detach');

    const closed = newCase([open, `closed false ${HEAD}`]);
    expect(closed.wait().status).toBe(0);
    expect(closed.lines('talk.log')[0]).toContain(': closed without merging');

    const pushed = newCase([open, `open false ${'b'.repeat(40)}`]);
    expect(pushed.wait().status).toBe(0);
    expect(pushed.lines('talk.log')[0]).toContain(
      ': head changed to bbbbbbbbbbbb; this wait ended'
    );
  });

  it('waits for the merge, not the checks, with --until merged', () => {
    const c = newCase([open, open, `closed true ${HEAD}`], {
      runs: tsv(check('completed', 'success', 'rust')),
    });
    expect(c.wait(['--until', 'merged']).status).toBe(0);
    expect(c.lines('talk.log')).toEqual([expect.stringContaining(': merged --detach')]);
    expect(c.lines('gh.log').join('\n')).not.toContain('check-runs');
    expect(c.lines('sleeps.log')).toHaveLength(1);
  });

  it('keeps the log and exits 3, without a retry, when the wake cannot be sent', () => {
    const c = newCase([open], {
      runs: tsv(check('completed', 'success', 'rust')),
      'talk-fails': '',
    });
    const result = c.wait();
    expect(result.status).toBe(3);
    expect(c.lines('talk.log')).toHaveLength(1);
    // The starter points the waiting process's output at this log.
    expect(existsSync(result.log)).toBe(true);
    expect(result.stdout).toContain('wake could not be sent to core-ops; not retried');
  });

  it('starts one detached wait with an owner-only log and returns at once', () => {
    const c = newCase([open, `closed true ${HEAD}`]);
    const result = c.run(['42', '--identity', 'core-ops', '--until', 'merged']);
    expect(result.status).toBe(0);
    const match = /^ci-wake: pid \d+ waiting on #42 \(merged\); log (\S+)\n$/.exec(result.stdout);
    expect(match).not.toBeNull();
    const logs = path.join(c.home, 'ci-wake');
    expect(match![1]).toBe(path.join(logs, path.basename(match![1])));
    expect(statSync(logs).mode & 0o777).toBe(0o700);
    const deadline = Date.now() + 8_000;
    while (c.lines('talk.log').length === 0 && Date.now() < deadline) {
      spawnSync('/bin/sleep', ['0.1']);
    }
    expect(c.lines('talk.log')).toEqual([expect.stringContaining(': merged --detach --urgent')]);
    while (existsSync(match![1]) && Date.now() < deadline) spawnSync('/bin/sleep', ['0.1']);
    expect(existsSync(match![1])).toBe(false);
  });

  it('keeps an owner-only log of a detached wait whose wake failed', () => {
    const c = newCase([open, `closed true ${HEAD}`], { 'talk-fails': '' });
    const result = c.run(['42', '--identity', 'core-ops', '--until', 'merged']);
    expect(result.status).toBe(0);
    const log = /; log (\S+)\n$/.exec(result.stdout)![1];
    const deadline = Date.now() + 8_000;
    while (!readFileSync(log, 'utf8').includes('not retried') && Date.now() < deadline) {
      spawnSync('/bin/sleep', ['0.1']);
    }
    expect(readFileSync(log, 'utf8')).toContain('wake could not be sent to core-ops; not retried');
    expect(statSync(log).mode & 0o777).toBe(0o600);
    expect(c.lines('talk.log')).toHaveLength(1);
  });

  it('refuses to start when the seat cannot be resolved', () => {
    const c = newCase([open], { 'no-identity': '' });
    const result = c.run(['42', '--identity', 'nobody']);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('identity nobody cannot be resolved; nothing started.');
    expect(existsSync(path.join(c.home, 'ci-wake'))).toBe(false);
    expect(c.lines('gh.log')).toEqual([]);
  });

  it('rejects malformed invocations and bounds the interval and cap', () => {
    const c = newCase([open]);
    for (const args of [
      [],
      ['x', '--identity', 'core-ops'],
      ['42'],
      ['42', '--identity'],
      ['42', '--identity', 'core-ops', '--until', 'green'],
      ['42', '--identity', 'core-ops', '--interval', '60'],
      ['42', '--identity', 'core-ops', '--cap', '7201'],
      ['42', '--identity', 'core-ops', '--cap', '0'],
      ['42', '--identity', 'core-ops', '--bogus', '1'],
    ]) {
      expect(c.run(args).status, args.join(' ')).toBe(2);
    }
    expect(c.lines('gh.log')).toEqual([]);
    expect(c.lines('talk.log')).toEqual([]);
  });
});
