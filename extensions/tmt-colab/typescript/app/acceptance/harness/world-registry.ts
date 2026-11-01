import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every acceptance world this checkout starts, one line each (#5892). A world removes its own
 * private tmux server and root on every exit path it gets to run; a worker that is killed or
 * interrupted runs none, so the run's global setup and teardown sweep what the registry still
 * names. Only a recorded world's own asserted socket is ever stopped, never a PID or a host server.
 */
const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const registryPath = path.join(
  fs.realpathSync(os.tmpdir()),
  `tmt-acceptance-worlds-${createHash('sha256').update(checkout).digest('hex').slice(0, 16)}.jsonl`,
);

export interface RecordedWorld {
  root: string;
  socket: string;
}

/** Record a world as soon as its private server's socket is known. */
export function recordWorld(world: RecordedWorld): void {
  fs.appendFileSync(registryPath, `${JSON.stringify(world)}\n`, { mode: 0o600 });
}

function recorded(): RecordedWorld[] {
  if (!fs.existsSync(registryPath)) return [];
  return fs
    .readFileSync(registryPath, 'utf8')
    .split('\n')
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as RecordedWorld;
        return typeof value.root === 'string' && typeof value.socket === 'string' ? [value] : [];
      } catch {
        return [];
      }
    });
}

function listening(socket: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = net.connect(socket);
    client.once('connect', () => {
      client.destroy();
      resolve(true);
    });
    client.once('error', () => resolve(false));
  });
}

/**
 * Stop every recorded world whose private tmux server still accepts on its socket, remove its
 * root (unless TMT_ACCEPTANCE_KEEP=1), forget them all, and say which ones were still running.
 * `stop` is the world's own asserted stopper.
 */
export async function sweepWorlds(stop: (root: string, socket: string) => void): Promise<string[]> {
  const leaked: string[] = [];
  for (const world of recorded()) {
    if (!fs.existsSync(world.socket) || !(await listening(world.socket))) continue;
    leaked.push(world.root);
    stop(world.root, world.socket);
    for (let wait = 0; wait < 50 && (await listening(world.socket)); wait++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (await listening(world.socket)) throw new Error(`${world.socket} still accepts after stop`);
    if (process.env.TMT_ACCEPTANCE_KEEP !== '1')
      fs.rmSync(world.root, { recursive: true, force: true });
  }
  fs.rmSync(registryPath, { force: true });
  return leaked;
}
