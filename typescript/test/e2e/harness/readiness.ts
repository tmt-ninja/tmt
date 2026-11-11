import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { ProcessState } from './cleanup.js';
import type { MockEvent, CliProcess, CliResult } from './types.js';

/** Time for the CLI to reach a metadata barrier on a loaded host; only a hung CLI exceeds it. */
const METADATA_BARRIER_TIMEOUT_MS = 10_000;

export async function waitForEvent(
  readEvents: () => MockEvent[],
  predicate: (event: MockEvent) => boolean,
  timeoutMs: number
): Promise<MockEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readEvents().find(predicate);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for mock-agent event. Events: ${JSON.stringify(readEvents())}`
  );
}

interface ProcessObservation {
  status: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  error?: unknown;
}

interface ProcessCommandEvidence {
  command: string[];
  status: number | null;
  signal: string | null;
  error: string | null;
  stderr: string;
}

/** Read-only evidence; never supplies signalling or cleanup authority. */
export function processGroupSnapshot(
  pid: number,
  inspect: (args: string[]) => ProcessObservation = (args) =>
    spawnSync('/bin/ps', args, {
      encoding: 'utf8',
      timeout: 1_000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
): { leader: ProcessCommandEvidence; census: ProcessCommandEvidence; rows: string } {
  const observe = (args: string[]) => {
    let result: ProcessObservation;
    try {
      result = inspect(args);
    } catch {
      result = { status: null, error: { code: 'unavailable' } };
    }
    return {
      result,
      evidence: {
        command: ['/bin/ps', ...args],
        status: result.status,
        signal: result.signal ?? null,
        error:
          result.error === undefined
            ? null
            : typeof result.error === 'object' &&
                result.error !== null &&
                'code' in result.error &&
                typeof result.error.code === 'string'
              ? result.error.code.slice(0, 128)
              : 'unavailable',
        stderr: (result.stderr ?? '').slice(-4_096),
      },
    };
  };
  const leader = observe(['-p', String(pid), '-o', 'pgid=', '-o', 'lstart=']);
  const census = observe([
    '-ax',
    '-o',
    'pid=',
    '-o',
    'ppid=',
    '-o',
    'pgid=',
    '-o',
    'stat=',
    '-o',
    'args=',
  ]);
  const rows = (census.result.stdout ?? '')
    .split('\n')
    .filter((line) => Number(/^\s*\d+\s+\d+\s+(\d+)\s/.exec(line)?.[1]) === pid)
    .slice(0, 16)
    .join('\n')
    .slice(0, 8_192);
  return {
    leader: leader.evidence,
    census: census.evidence,
    rows:
      rows ||
      (census.result.status === 0 && !census.result.error
        ? '[no matching processes]'
        : '[unavailable]'),
  };
}

/** Timeout evidence only: no environment values or unrelated process rows. */
export function mockReadinessSnapshot(
  pid: number,
  environmentKeys: readonly string[],
  readCapture: () => string
): { pid: number; environmentKeys: string[]; environmentKeysTruncated: boolean; pane: string } {
  let pane: string;
  try {
    pane = readCapture().slice(-16_384);
  } catch {
    // Do not dump subprocess errors: they may retain unfiltered stdout/stderr.
    pane = '[unavailable]';
  }
  const keys: string[] = [];
  let size = 0;
  for (const key of [...environmentKeys].sort()) {
    if (size + key.length > 8_192 || keys.length === 256) break;
    keys.push(key);
    size += key.length;
  }
  return {
    pid,
    environmentKeys: keys,
    environmentKeysTruncated: keys.length !== environmentKeys.length,
    pane,
  };
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  description: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

/** A shell may create the file before writing: only a complete positive PID is ready. */
export async function waitForPidFile(file: string, timeoutMs: number): Promise<number> {
  let pid = 0;
  await waitFor(
    () => {
      if (!fs.existsSync(file)) return false;
      const text = fs.readFileSync(file, 'utf8');
      if (!/^[1-9]\d*\n$/.test(text)) return false;
      const value = Number(text);
      if (!Number.isSafeInteger(value) || value <= 1) return false;
      pid = value;
      return true;
    },
    timeoutMs,
    'foreground process readiness'
  );
  return pid;
}

/** How a bounded wait for processes to exit ended; only `exited` proves every one is gone. */
export type ProcessExit =
  | { outcome: 'exited' }
  | { outcome: 'timed-out'; running: number[]; unknown: number[] }
  | { outcome: 'unknown'; unknown: number[] };

/**
 * Wait up to `timeoutMs` for every pid to be proven absent. A pid whose state stays
 * unknown is reported as such, not as exited; one that is still running at the
 * deadline is a timeout the caller must report, not a reason to wait longer.
 */
export async function waitForProcessExit(
  pids: readonly number[],
  probe: (pid: number) => ProcessState,
  timeoutMs = 2_000
): Promise<ProcessExit> {
  const survey = (): { running: number[]; unknown: number[] } => {
    const states = pids.map((pid) => [pid, probe(pid)] as const);
    return {
      running: states.filter(([, state]) => state === 'running').map(([pid]) => pid),
      unknown: states.filter(([, state]) => state === 'unknown').map(([pid]) => pid),
    };
  };
  const deadline = Date.now() + timeoutMs;
  let { running, unknown } = survey();
  while (Date.now() < deadline && running.length + unknown.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    ({ running, unknown } = survey());
  }
  if (running.length > 0) return { outcome: 'timed-out', running, unknown };
  if (unknown.length > 0) return { outcome: 'unknown', unknown };
  return { outcome: 'exited' };
}

export async function waitForCapture(
  readCapture: () => string,
  predicate: (output: string) => boolean,
  timeoutMs = 10_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = readCapture();
    if (predicate(output)) return output;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for mock-agent pane output.\n${readCapture()}`);
}

/** Appended events are committed only by their newline; reread the tail on the next poll. */
export function readCompleteJsonLines<T = unknown>(logPath: string): T[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .slice(0, -1)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch (cause) {
        throw new SyntaxError(`Invalid complete JSON log line in ${logPath}: ${line}`, { cause });
      }
    });
}

export function readMockEvents(logPath: string): MockEvent[] {
  return readCompleteJsonLines<MockEvent>(logPath);
}

/**
 * Wait for the CLI to reach the barrier. This is a readiness wait: reaching it
 * takes as long as the CLI needs on a loaded host, so the bound is generous and
 * exists only to end a hung CLI. Pass the CLI process to fail at once, with its
 * exit status and output, when it exits before reaching the barrier.
 */
export async function waitForMetadataBarrier(
  directory: string,
  signal: 'entered' | 'applied',
  options: { child?: CliProcess<unknown>; timeoutMs?: number }
): Promise<void> {
  const barrier = path.join(directory, signal);
  let exited = undefined as CliResult<unknown> | undefined;
  void options.child?.result.then((result) => {
    exited = result;
  });
  await waitFor(
    () => fs.existsSync(barrier) || exited !== undefined,
    options.timeoutMs ?? METADATA_BARRIER_TIMEOUT_MS,
    `metadata barrier '${signal}'`
  );
  if (!fs.existsSync(barrier) && exited) {
    throw new Error(
      `The CLI exited with code ${exited.code} before metadata barrier '${signal}'.\n` +
        `stdout: ${exited.stdout.trim()}\nstderr: ${exited.stderr.trim()}`
    );
  }
}

export function readPaneTarget(tmux: (args: string[]) => string, pane: string): string {
  return tmux([
    'display-message',
    '-p',
    '-t',
    pane,
    '#{session_name}:#{window_index}.#{pane_index}',
  ]).trim();
}
