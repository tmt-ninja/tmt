import { readFileSync } from 'node:fs';
import type { FullResult, Reporter } from '@playwright/test/reporter';

/** Fails the run with a web server's own exit reason, as `e2e/web-server.mjs` recorded it, so a
 * dead server reads as that and not as the refused connections that followed it (#6804). */
export default class WebServerExitReporter implements Reporter {
  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const file = process.env.BROWSER_UI_SERVER_EXIT;
    let reasons = '';
    try {
      reasons = file ? readFileSync(file, 'utf8').trim() : '';
    } catch {
      // No file: every server ran to the end.
    }
    if (!reasons) return undefined;
    process.stderr.write(`\n${reasons}\n`);
    return result.status === 'passed' || result.status === 'interrupted'
      ? { status: 'failed' }
      : undefined;
  }

  printsToStdio(): boolean {
    return false;
  }
}
