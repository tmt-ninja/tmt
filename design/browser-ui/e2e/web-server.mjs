// A dev server for the gallery, docs or Colab app, run by Playwright's webServer. A server that dies
// mid-run (a V8 abort, #5846) used to show only as refused connections in whichever specs ran
// next. This records why it stopped for the run's reporter, which says it once at the end, and
// stops the run.
//
//   node e2e/web-server.mjs <name> <command> [args...]
//
// TMT_PLAYWRIGHT_SERVER_EXIT is the reporter's run-local file. TMT_PLAYWRIGHT_RUNNER_PID is
// the runner that owns this server.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { constants } from 'node:os';

const [name, command, ...args] = process.argv.slice(2);
if (!name || !command) throw new Error('usage: web-server.mjs <name> <command> [args...]');
const child = spawn(command, args, { stdio: ['inherit', 'inherit', 'pipe'] });
const tailBytes = 4096;
let tail = Buffer.alloc(0);
child.stderr.pipe(process.stderr, { end: false });
child.stderr.on('data', (chunk) => {
  tail = Buffer.concat([tail, chunk.subarray(-tailBytes)]).subarray(-tailBytes);
});
let stopping = false;
for (const signal of /** @type {const} */ (['SIGTERM', 'SIGINT', 'SIGHUP']))
  process.on(signal, () => {
    // Playwright ending the run: the server stops on purpose, and nothing is reported.
    stopping = true;
    child.kill(signal);
  });
let spawnFailed = false;
child.once('error', () => {
  spawnFailed = true;
});
child.once('close', (code, signal) =>
  stopped(
    spawnFailed
      ? 'could not start'
      : signal
        ? `signal ${signal}`
        : `exit code ${code}${killedBy(code)}`,
    code ?? 1,
  ),
);

/** A shell or launcher reports a child killed by a signal as 128 + its number (134: SIGABRT). */
function killedBy(/** @type {number | null} */ code) {
  if (code === null || code <= 128) return '';
  const name = Object.entries(constants.signals).find(([, number]) => number === code - 128)?.[0];
  return name ? `, ${name}` : '';
}

/** @param {string} how @param {number} code */
function stopped(how, code) {
  process.exitCode = code === 0 && !stopping ? 1 : code;
  if (!stopping) {
    // Latin-1 keeps one character per original byte for the redaction count.
    const stderr = tail
      .toString('latin1')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(-4);
    // Keep the known V8 diagnosis. Other text can contain paths, payloads or secrets.
    const signature = 'Lazy deopt after a fast API call with return value is unsupported';
    const redacted = stderr.map((line) =>
      line.includes(signature) ? signature : `[redacted ${line.length} bytes]`,
    );
    const reason = `The ${name} web server stopped unexpectedly (${how}). Stderr tail: ${redacted.join(' | ') || '(empty)'}.`;
    const file = process.env.TMT_PLAYWRIGHT_SERVER_EXIT;
    if (!file) return;
    try {
      writeFileSync(file, `${reason}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      // The gallery owns two servers. Report and interrupt only for the first death.
      if (error?.code === 'EEXIST') return;
      throw error;
    }
    if (existsSync(`${file}.tests-passed`)) return;
    const runner = Number(process.env.TMT_PLAYWRIGHT_RUNNER_PID);
    // The run stops here rather than failing every later spec on a refused connection.
    if (Number.isSafeInteger(runner) && runner > 1) {
      try {
        process.kill(runner, 'SIGINT');
      } catch {
        // The runner is gone already.
      }
    }
  }
}
