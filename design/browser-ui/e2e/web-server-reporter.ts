import { writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

/** Reports the first unexpected dev-server exit without invalidating completed tests. */
export default class WebServerExitReporter implements Reporter {
  private readonly file = process.env.TMT_PLAYWRIGHT_SERVER_EXIT;
  private pending = new Set<string>();

  onBegin(_config: unknown, suite: Suite): void {
    this.pending = new Set(suite.allTests().map((test) => test.id));
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.file || result.status !== test.expectedStatus || !this.pending.delete(test.id))
      return;
    if (this.pending.size !== 0) return;
    try {
      writeFileSync(`${this.file}.tests-passed`, '', { mode: 0o600 });
    } catch {
      // A diagnostics-path failure must not change a test's status.
    }
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    if (!this.file) return;
    const reasons = (await readFile(this.file, 'utf8').catch(() => '')).trim();
    await Promise.all([
      rm(`${this.file}.tests-passed`, { force: true }).catch(() => {}),
      rm(this.file, { force: true }).catch(() => {}),
    ]);
    if (!reasons) return undefined;
    process.stderr.write(`\n${reasons}\n`);
    return result.status === 'interrupted' ? { status: 'failed' } : undefined;
  }

  printsToStdio(): boolean {
    return false;
  }
}
