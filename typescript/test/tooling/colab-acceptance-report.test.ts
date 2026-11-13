import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';

const script = fileURLToPath(new URL('../../scripts/colab-acceptance-report.mjs', import.meta.url));
const secret = 'PRIVATE_CREDENTIAL_SENTINEL';

interface FixtureResult {
  status: string;
  duration: number;
  errorLocation: { file: string; line: number | string; column: number };
  error: { message: string; stack: string };
  attachments: { name?: string; contentType?: string; body: string; path?: string }[];
  stdout: string[];
  stderr: string[];
}

/** Reject lexical escapes before any filesystem operation, then check existing real ancestry. */
function fixturePath(
  root: string,
  file: string,
  resolve: (file: string) => string = realpathSync
): string {
  const candidate = path.resolve(file);
  const inside = (value: string) => {
    const relative = path.relative(root, value);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  if (!inside(candidate)) throw new Error('Fixture path escapes its temporary root');
  let ancestor = candidate;
  for (;;) {
    try {
      if (!inside(resolve(ancestor)))
        throw new Error('Fixture realpath escapes its temporary root');
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}

function runReport(
  change?: (result: FixtureResult, root: string) => void,
  missing = false,
  execution: unknown = { state: 'completed', exitCode: 1 },
  raw?: string,
  title = 'Exact source fixture'
) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tmt-colab-report-')));
  try {
    const source = path.join(root, 'extensions/tmt-colab/typescript/app/acceptance');
    mkdirSync(fixturePath(root, source), { recursive: true });
    writeFileSync(fixturePath(root, path.join(source, 'page-size.spec.ts')), '// Public fixture\n');
    const result: FixtureResult = {
      status: 'failed',
      duration: 6078,
      errorLocation: { file: path.join(source, 'page-size.spec.ts'), line: 38, column: 7 },
      error: { message: `Timeout 5000ms exceeded\n${secret}`, stack: secret },
      attachments: [{ body: secret }],
      stdout: [secret],
      stderr: [secret],
    };
    change?.(result, root);
    const report = {
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  file: path.basename(result.errorLocation.file),
                  title,
                  tests: [
                    {
                      status: result.status === 'passed' ? 'expected' : 'unexpected',
                      expectedStatus: 'passed',
                      results: [result],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const input = path.join(root, 'private.json');
    if (!missing) writeFileSync(fixturePath(root, input), raw ?? JSON.stringify(report));
    mkdirSync(fixturePath(root, path.join(root, 'colab-acceptance-private')));
    writeFileSync(
      fixturePath(root, path.join(root, 'colab-acceptance-private/execution.json')),
      JSON.stringify(execution)
    );
    const child = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: input, RUNNER_TEMP: root },
    });
    expect(child.error).toBeUndefined();
    const stdout = child.stdout;
    const outcomeFile = path.join(root, 'colab-acceptance-results/outcomes.json');
    expect(existsSync(outcomeFile), child.stderr.slice(0, 4096)).toBe(true);
    const text = readFileSync(outcomeFile, 'utf8');
    expect(text + stdout).not.toContain(secret);
    expect(text + stdout).not.toContain(root);
    const parsed = JSON.parse(text);
    expect(child.status).toBe(parsed.run.status === 'passed' ? 0 : 1);
    expect(child.stderr).not.toContain(secret);
    return { report: parsed, stdout };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('public Colab acceptance evidence', () => {
  it('rejects an outside fixture path before any filesystem call', () => {
    let calls = 0;
    const resolve = () => {
      calls++;
      throw new Error('Filesystem must not be reached');
    };
    expect(() =>
      fixturePath('/private/tmp/fixture-root', '/private/PRIVATE_CREDENTIAL_SENTINEL', resolve)
    ).toThrow('Fixture path escapes');
    expect(calls).toBe(0);
  });

  it('rejects fixture writes through a symlink outside the temporary root', () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tmt-colab-guard-')));
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tmt-colab-outside-')));
    try {
      symlinkSync(outside, fixturePath(root, path.join(root, 'link')));
      expect(() => fixturePath(root, path.join(root, 'link', 'private'))).toThrow(
        'Fixture realpath escapes'
      );
      expect(existsSync(path.join(outside, 'private'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  const diagnostic = {
    root: 'messages',
    kind: 'ask-state',
    streamId: '30000000-0000-4000-8000-000000000001',
    submittedSeq: '7',
    admittedSeq: '4',
    leaderReceipt: true,
  };
  const attachment = (value: unknown) => ({
    name: 'colab-own-publication',
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(value)).toString('base64'),
  });

  it('retains only a typed own-publication attachment, never generic private errors', () => {
    const { report } = runReport((result) => {
      result.attachments.push(attachment(diagnostic));
    });
    expect(report.tests[0].results[0].ownPublications).toEqual([diagnostic]);
  });

  it.each(['attachment-publication', 'edit-request'])(
    'retains %s only under its intents root',
    (kind) => {
      const row = { ...diagnostic, root: 'intents', kind };
      const { report } = runReport((result) => {
        result.attachments.push(attachment(row), attachment({ ...row, root: 'messages' }));
      });
      expect(report.tests[0].results[0].ownPublications).toEqual([row]);
    }
  );

  it.each([
    { key: secret },
    { value: secret },
    { url: secret },
    { root: secret },
    { kind: secret },
    { streamId: secret },
    { submittedSeq: secret },
    { admittedSeq: 4 },
    { submittedSeq: '18446744073709551616' },
    { leaderReceipt: secret },
  ])('drops diagnostics outside the closed schema: %j', (change) => {
    const { report } = runReport((result) => {
      result.attachments.push(attachment({ ...diagnostic, ...change }));
    });
    expect(report.tests[0].results[0]).not.toHaveProperty('ownPublications');
  });

  it('does not follow attachment paths or copy unnamed JSON attachments', () => {
    const { report } = runReport((result) => {
      result.attachments.push(
        { ...attachment(diagnostic), name: 'private-diagnostic', path: secret },
        { ...attachment(diagnostic), body: '', path: secret }
      );
    });
    expect(report.tests[0].results[0]).not.toHaveProperty('ownPublications');
  });

  it.each([{ contentType: 'text/plain' }, { body: 'not base64' }, { body: 'A'.repeat(1028) }])(
    'drops malformed or oversized diagnostic attachments: %j',
    (change) => {
      const { report } = runReport((result) => {
        result.attachments.push({ ...attachment(diagnostic), ...change });
      });
      expect(report.tests[0].results[0]).not.toHaveProperty('ownPublications');
    }
  );

  describe('Live-status diagnostic', () => {
    const live = { state: 'opening', frame: true, visibility: 'hidden', ended: 'session' };
    const liveAttachment = (value: unknown) => ({ ...attachment(value), name: 'colab-live-state' });

    it('retains only a closed state, frame presence, visibility and ended cause', () => {
      const { report } = runReport((result) => {
        result.attachments.push(liveAttachment(live));
      });
      expect(report.tests[0].results[0].liveStates).toEqual([live]);
    });

    it.each([
      { state: secret },
      { state: 'Opening page…' },
      { frame: 'yes' },
      { visibility: secret },
      { ended: secret },
      { ended: 'Session ended' },
      { text: secret },
    ])('drops a diagnostic outside the closed schema: %j', (change) => {
      const { report } = runReport((result) => {
        result.attachments.push(liveAttachment({ ...live, ...change }));
      });
      expect(report.tests[0].results[0]).not.toHaveProperty('liveStates');
    });

    it.each([
      'access',
      'revoked',
      'expired',
      'mismatch',
      'unpaired',
      'gone',
      'session',
      'large',
      'capacity',
      'generic',
      'none',
      'other',
    ])('retains the closed ended cause %s', (ended) => {
      const { report } = runReport((result) => {
        result.attachments.push(liveAttachment({ ...live, ended }));
      });
      expect(report.tests[0].results[0].liveStates).toEqual([{ ...live, ended }]);
    });

    it('drops a row with a missing field and a diagnostic on a passing result', () => {
      const { frame: _frame, ...partial } = live;
      const { ended: _ended, ...withoutEnded } = live;
      for (const row of [partial, withoutEnded])
        expect(
          runReport((result) => {
            result.attachments.push(liveAttachment(row));
          }).report.tests[0].results[0]
        ).not.toHaveProperty('liveStates');
      expect(
        runReport((result) => {
          result.status = 'passed';
          result.attachments.push(liveAttachment(live));
        }).report.tests[0].results[0]
      ).not.toHaveProperty('liveStates');
    });

    it('does not accept the own-publication name for a live state or the reverse', () => {
      const { report } = runReport((result) => {
        result.attachments.push(attachment(live), liveAttachment(diagnostic));
      });
      expect(report.tests[0].results[0]).not.toHaveProperty('liveStates');
      expect(report.tests[0].results[0]).not.toHaveProperty('ownPublications');
    });
  });

  it('does not turn a passing result into publication failure evidence', () => {
    const { report } = runReport((result) => {
      result.status = 'passed';
      result.attachments.push(attachment(diagnostic));
    });
    expect(report.tests[0].results[0]).not.toHaveProperty('ownPublications');
  });

  it('retains a located failure and numeric poll timeout without private payloads', () => {
    const { report, stdout } = runReport();
    const expected = {
      status: 'failed',
      duration: 6078,
      failure: {
        file: 'acceptance/page-size.spec.ts',
        line: 38,
        column: 7,
        timeoutMs: 5000,
      },
    };
    expect(report.tests[0].results).toEqual([expected]);
    expect(JSON.parse(stdout)).toEqual(report.tests[0]);
  });

  it.each(['external', 'missing', 'symlink', 'line', 'column'])('rejects %s locations', (kind) => {
    const { report } = runReport((result, root) => {
      if (kind === 'external') result.errorLocation.file = `/private/${secret}`;
      if (kind === 'missing')
        result.errorLocation.file = result.errorLocation.file.replace('page-size', 'absent');
      if (kind === 'symlink') {
        writeFileSync(fixturePath(root, result.errorLocation.file + '.private'), secret);
        rmSync(fixturePath(root, result.errorLocation.file));
        symlinkSync(
          fixturePath(root, result.errorLocation.file + '.private'),
          fixturePath(root, result.errorLocation.file)
        );
      }
      if (kind === 'line') result.errorLocation.line = '38';
      if (kind === 'column') result.errorLocation.column = 0;
    });
    expect(report.tests[0].results).toEqual([{ status: 'failed', duration: 6078 }]);
  });

  it('bounds a timeout while retaining the source location', () => {
    const { report } = runReport((result) => {
      result.error.message = 'Timeout 1800001ms exceeded';
    });
    expect(report.tests[0].results[0].failure).toEqual({
      file: 'acceptance/page-size.spec.ts',
      line: 38,
      column: 7,
    });
  });

  it.each(['deadline', 'interrupted', 'running', 'startup-failed', 'runner-failed'])(
    'keeps a %s verdict incomplete even when the flushed case passed',
    (state) => {
      const { report } = runReport(
        (result) => {
          result.status = 'passed';
        },
        false,
        { state, private: secret }
      );
      expect(report.run).toEqual({ status: 'incomplete', reason: state });
      expect(report.tests).toHaveLength(1);
    }
  );

  it('sanitizes malformed JSON and invalid execution without copying private parse errors', () => {
    expect(
      runReport(undefined, false, { state: 'completed', exitCode: 0 }, secret).report.run
    ).toEqual({ status: 'incomplete', reason: 'malformed-report' });
    expect(runReport(undefined, false, { state: secret }).report.run).toEqual({
      status: 'incomplete',
      reason: 'invalid-execution',
    });
  });

  it('requires complete execution and report evidence for a passing verdict', () => {
    expect(
      runReport(
        (result) => {
          result.status = 'passed';
        },
        false,
        { state: 'completed', exitCode: 0 }
      ).report.run
    ).toEqual({ status: 'passed', reason: 'complete' });
  });

  it('retains an ordinary failure as failed and an interrupted result as incomplete', () => {
    expect(runReport().report.run).toEqual({ status: 'failed', reason: 'complete' });
    expect(
      runReport((result) => {
        result.status = 'interrupted';
      }).report.run
    ).toEqual({ status: 'incomplete', reason: 'interrupted-report' });
  });

  it('marks missing final JSON incomplete instead of publishing an empty successful run', () => {
    const { report, stdout } = runReport(undefined, true);
    expect(report).toEqual({ run: { status: 'incomplete', reason: 'missing-report' }, tests: [] });
    expect(JSON.parse(stdout)).toEqual({ run: report.run });
  });
});

describe('acceptance Core wrapper', () => {
  it('forwards exact stdout and exit status', () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tmt-acc-wrapper-')));
    try {
      const barrier = fixturePath(root, path.join(root, 'barrier'));
      mkdirSync(barrier);
      const child = fixturePath(root, path.join(root, 'child.cjs'));
      const output = JSON.stringify({ error: { code: 'PANE_NOT_FOUND', message: secret } });
      writeFileSync(
        child,
        `process.stdout.write(${JSON.stringify(output)}); process.exitCode = 7;`
      );
      const wrapper = fileURLToPath(
        new URL(
          '../../../extensions/tmt-colab/typescript/app/acceptance/harness/core-barrier.mjs',
          import.meta.url
        )
      );
      const result = spawnSync(process.execPath, [wrapper, child], {
        input: '',
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          TMT_ACCEPTANCE_REAL_TMT: process.execPath,
          TMT_ACCEPTANCE_BARRIER_DIR: barrier,
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(7);
      expect(result.stdout).toBe(output);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
