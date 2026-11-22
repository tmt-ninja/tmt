import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vite-plus/test';
import WebServerExitReporter from '../e2e/web-server-reporter.js';

const reason = 'The colab-app web server stopped unexpectedly (signal SIGABRT).';
type Suite = Parameters<WebServerExitReporter['onBegin']>[1];
type TestCase = Parameters<WebServerExitReporter['onTestEnd']>[0];
type TestResult = Parameters<WebServerExitReporter['onTestEnd']>[1];

it.each(['passed', 'failed', 'interrupted'] as const)(
  'reports a server death with run status %s',
  async (status) => {
    const directory = mkdtempSync(join(tmpdir(), 'tmt-web-server-reporter-'));
    const exit = join(directory, 'exit');
    const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.stubEnv('TMT_PLAYWRIGHT_SERVER_EXIT', exit);
    try {
      const reporter = new WebServerExitReporter();
      const first = { id: 'first', expectedStatus: 'passed' } as TestCase;
      const last = { id: 'last', expectedStatus: 'passed' } as TestCase;
      const passed = { status: 'passed' } as TestResult;
      reporter.onBegin({}, { allTests: () => [first, last] } as Suite);
      reporter.onTestEnd(first, passed);
      expect(existsSync(`${exit}.tests-passed`)).toBe(false);
      if (status === 'passed') reporter.onTestEnd(last, passed);
      if (status === 'failed') reporter.onTestEnd(last, { status: 'failed' } as TestResult);
      expect(existsSync(`${exit}.tests-passed`)).toBe(status === 'passed');
      writeFileSync(exit, `${reason}\n`);

      expect(await reporter.onEnd({ status, startTime: new Date(0), duration: 0 })).toEqual(
        status === 'interrupted' ? { status: 'failed' } : undefined,
      );
      expect(output.mock.calls).toEqual([[`\n${reason}\n`]]);
      expect(existsSync(exit)).toBe(false);
      expect(existsSync(`${exit}.tests-passed`)).toBe(false);
    } finally {
      output.mockRestore();
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it('leaves a normal Playwright interrupt unchanged without a recorded server exit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tmt-web-server-interrupt-'));
  const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.stubEnv('TMT_PLAYWRIGHT_SERVER_EXIT', join(directory, 'missing'));
  try {
    const result = { status: 'interrupted' as const, startTime: new Date(0), duration: 0 };
    expect(await new WebServerExitReporter().onEnd(result)).toBeUndefined();
    expect(output).not.toHaveBeenCalled();
  } finally {
    output.mockRestore();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('records a bounded stderr tail with only the known crash signature visible', () => {
  const wrapper = fileURLToPath(new URL('../e2e/web-server.mjs', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'tmt-web-server-wrapper-'));
  const exit = join(directory, 'exit');
  const signature = 'Lazy deopt after a fast API call with return value is unsupported';
  try {
    const result = spawnSync(
      process.execPath,
      [
        wrapper,
        'fixture',
        process.execPath,
        '-e',
        'process.stderr.write("x".repeat(6000) + "\\nprivate payload\\n" + process.argv[1] + "\\n"); process.exitCode = 134;',
        signature,
      ],
      {
        env: { ...process.env, TMT_PLAYWRIGHT_SERVER_EXIT: exit, TMT_PLAYWRIGHT_RUNNER_PID: '' },
        encoding: 'utf8',
        timeout: 5_000,
      },
    );
    expect(result.status).toBe(134);
    const retainedFirstLine = 4096 - Buffer.byteLength(`\nprivate payload\n${signature}\n`);
    expect(readFileSync(exit, 'utf8')).toBe(
      `The fixture web server stopped unexpectedly (exit code 134, SIGABRT). Stderr tail: [redacted ${retainedFirstLine} bytes] | [redacted 15 bytes] | ${signature}.\n`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
