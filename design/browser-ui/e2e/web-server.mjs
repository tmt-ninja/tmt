// One dev server for the gallery audits, run by Playwright's webServer (#6804). A server that dies
// mid-run (a V8 abort, #5846) used to show only as refused connections in whichever specs ran
// next. This records why it stopped for the run's reporter, which says it once at the end, and
// stops the run.
//
//   node e2e/web-server.mjs <name> <command> [args...]
//
// BROWSER_UI_SERVER_EXIT names the file the reason is appended to, and BROWSER_UI_RUNNER_PID the
// Playwright runner to interrupt; playwright.config.ts sets both once per run.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { constants } from 'node:os';

const [name, command, ...args] = process.argv.slice(2);
if (!name || !command) throw new Error('usage: web-server.mjs <name> <command> [args...]');
const child = spawn(command, args, { stdio: 'inherit' });
let stopping = false;
for (const signal of /** @type {const} */ (['SIGTERM', 'SIGINT', 'SIGHUP']))
  process.on(signal, () => {
    // Playwright ending the run: the server stops on purpose, and nothing is reported.
    stopping = true;
    child.kill(signal);
  });
child.on('error', (error) => stopped(`could not start: ${error.message}`, 1));
child.on('exit', (code, signal) =>
  stopped(signal ? `signal ${signal}` : `exit code ${code}${killedBy(code)}`, code ?? 1),
);

/** A shell or launcher reports a child killed by a signal as 128 + its number (134: SIGABRT). */
function killedBy(/** @type {number | null} */ code) {
  if (code === null || code <= 128) return '';
  const name = Object.entries(constants.signals).find(([, number]) => number === code - 128)?.[0];
  return name ? `, ${name}` : '';
}

/** @param {string} how @param {number} code */
function stopped(how, code) {
  if (!stopping) {
    const reason = `The ${name} web server stopped mid-run (${how}). Its own output is above, prefixed [WebServer]; failures after this point are not spec failures.`;
    const file = process.env.BROWSER_UI_SERVER_EXIT;
    if (file) appendFileSync(file, `${reason}\n`);
    const runner = Number(process.env.BROWSER_UI_RUNNER_PID);
    // The run stops here rather than failing every later spec on a refused connection.
    if (Number.isSafeInteger(runner) && runner > 1) {
      try {
        process.kill(runner, 'SIGINT');
      } catch {
        // The runner is gone already.
      }
    }
  }
  process.exit(code === 0 ? 1 : code);
}
