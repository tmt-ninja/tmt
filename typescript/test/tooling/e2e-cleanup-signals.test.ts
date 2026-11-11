import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vite-plus/test';
import { assertPrivateSocket, stopPrivateTmuxSocket } from '../support/private-tmux.js';
import { groupLeader, stopOwnedGroups, type OwnedGroup } from '../e2e/harness/lifecycle.js';
import { waitFor, waitForPidFile } from '../e2e/harness/readiness.js';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite-plus/package.json'));
const vitest = path.join(path.dirname(viteRequire.resolve('vitest/package.json')), 'vitest.mjs');
const lifecycle = fileURLToPath(new URL('../e2e/harness/lifecycle.ts', import.meta.url));
const readinessModule = fileURLToPath(new URL('../e2e/harness/readiness.ts', import.meta.url));
const fixtureModule = fileURLToPath(new URL('../e2e/harness/fixture.ts', import.meta.url));
// Read-only provenance: a Linux CI pass can establish whether it exercised uutils.
if (process.platform === 'linux') {
  const version = spawnSync('/bin/sleep', ['--version'], { encoding: 'utf8', timeout: 1000 });
  console.info(
    'cleanup-signal sleep provenance:',
    version.status === 0 ? version.stdout.split('\n')[0] : 'unavailable'
  );
}

const executableWriter = fileURLToPath(
  new URL('../support/executable-fixture.mjs', import.meta.url)
);

interface Proof {
  root: string;
  socketRoot: string;
  socket: string;
  tmux: string;
  pid: number;
  started: string;
  panePid?: number;
  pidFile?: string;
  startFile?: string;
  registry?: string;
}

function removeProbeRegistry(registry: string): void {
  const parent = fs.realpathSync(os.tmpdir());
  if (path.dirname(registry) !== parent || !path.basename(registry).startsWith('tmt-e2e-run-')) {
    throw new Error(`refusing non-owned registry: ${registry}`);
  }
  fs.rmSync(registry, { recursive: true, force: true });
}

it.each(['', '12', '0\n', '1\n', 'not-a-pid\n', '9007199254740993\n'])(
  'waits for complete positive PID publication after %j',
  async (incomplete) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pid-readiness-'));
    const file = path.join(root, 'pid');
    fs.writeFileSync(file, incomplete);
    let settled = false;
    const pending = waitForPidFile(file, 1_000).then((pid) => {
      settled = true;
      return pid;
    });
    try {
      // Hold publication across a complete event-loop turn. Existence-only
      // readiness resolves here; the complete-record barrier must stay pending.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled, 'an incomplete PID file is not process readiness').toBe(false);
      fs.writeFileSync(file, '12345\n');
      expect(await pending).toBe(12345);
    } finally {
      fs.writeFileSync(file, '12345\n');
      await pending.catch(() => {});
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

it.each([
  'normal',
  'readiness failure',
  'timeout',
  'thrown exit',
  'thrown exit in allocation',
  'SIGINT',
  'SIGTERM',
  'foreground SIGINT',
  'foreground SIGTERM',
  'stale lock SIGTERM',
] as const)(
  'cleans the owned fixture on %s',
  async (scenario) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-signal-test-'));
    const home = path.join(directory, 'home');
    fs.mkdirSync(home);
    const proofFile = path.join(directory, 'proof.json');
    const config = path.join(directory, 'config.mjs');
    fs.writeFileSync(
      config,
      `export default { root: ${JSON.stringify(directory)}, cacheDir: ${JSON.stringify(path.join(directory, 'cache'))}, test: { globals: true, pool: 'threads', include: ['signal.test.js'], globalSetup: [${JSON.stringify(lifecycle)}], testTimeout: ${scenario === 'timeout' ? 5_000 : 60_000}, hookTimeout: 5000 } };\n`
    );
    fs.writeFileSync(
      path.join(directory, 'signal.test.js'),
      `
      import fs from 'node:fs';
      import path from 'node:path';
      import { E2EFixture } from ${JSON.stringify(fixtureModule)};
      import { groupLeader } from ${JSON.stringify(lifecycle)};
      import { writeExecutable } from ${JSON.stringify(executableWriter)};
      import { waitForPidFile } from ${JSON.stringify(readinessModule)};
      test('hold an owned fixture', async () => {
        const fixture = new E2EFixture();
        try {
          await fixture.start();
          const publishProof = (details) => {
            const stage = ${JSON.stringify(proofFile + '.tmp')};
            fs.writeFileSync(stage, JSON.stringify({ root: fixture.root, socketRoot: fixture.socketRoot, socket: fixture.socketPath, tmux: fixture.tmuxPath, pid: 0, started: '', registry: process.env.TMT_E2E_RUN_REGISTRY, ...details }));
            fs.renameSync(stage, ${JSON.stringify(proofFile)});
          };
          // Retain private cleanup ownership even if process readiness fails.
          publishProof({});
          const executable = path.join(fixture.root, 'bin', 'tmt-ops');
          // Keep the shim as the group leader; call sleep under its real utility name.
          writeExecutable(executable, ['#!/bin/sh', '/bin/sleep "$@" &', 'wait "$!"', ''].join(String.fromCharCode(10)), 0o755);
          let pid;
          let panePid;
          if (${JSON.stringify(scenario)}.startsWith('foreground ')) {
            const shell = fixture.createShellPane('foreground');
            panePid = shell.pid;
            const pidFile = path.join(fixture.root, 'foreground-pid');
            const startFile = path.join(fixture.root, 'foreground-start');
            publishProof({ pidFile, startFile });
            const script = 'trap ' + String.fromCharCode(34, 34) + ' HUP; echo $$ > ' + pidFile + '; LC_ALL=C /bin/ps -p $$ -o lstart= > ' + startFile + '; exec ' + executable + ' 60';
            const command = '/bin/sh -c ' + String.fromCharCode(39) + script + String.fromCharCode(39);
            fixture.tmux(['send-keys', '-t', shell.pane, '-l', command]);
            fixture.tmux(['send-keys', '-t', shell.pane, 'Enter']);
            pid = await waitForPidFile(pidFile, 5000);
          } else {
            pid = Number(fixture.tmux(['new-window', '-d', '-P', '-F', '#{pane_pid}', '-t', 'e2e', executable + ' 60']).trim());
          }
          const leader = groupLeader(pid);
          if (!leader) throw new Error('fixture group leader disappeared');
          if (${JSON.stringify(scenario)} === 'stale lock SIGTERM') fs.mkdirSync(path.join(process.env.TMT_E2E_RUN_REGISTRY, '.lock'));
          publishProof({ pid, panePid, started: leader.started });
          if (${JSON.stringify(scenario)} === 'readiness failure') throw new Error('controlled fixture readiness failure');
        } catch (error) {
          try {
            await fixture.stop();
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'fixture readiness and cleanup failed');
          }
          throw error;
        }
        if (${JSON.stringify(scenario)} === 'normal') { await fixture.stop(); return; }
        if (${JSON.stringify(scenario)} === 'thrown exit') process.exit(42);
        if (${JSON.stringify(scenario)} === 'thrown exit in allocation') fixture.registration.allocate(() => process.exit(42), () => {});
        await new Promise(() => {});
      });
    `
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: home,
      XDG_DATA_HOME: home,
      XDG_STATE_HOME: home,
      XDG_CACHE_HOME: home,
      TMT_TEST_CLI: JSON.stringify({ executable: '/usr/bin/true', args: [] }),
      NODE_DISABLE_COMPILE_CACHE: '1',
    };
    delete env.TMUX;
    delete env.TMUX_PANE;
    let child: ChildProcess | undefined;
    let proof: Proof | undefined;
    let ownedGroup: OwnedGroup | undefined;
    let output = '';
    try {
      child = spawn(process.execPath, [vitest, 'run', '--config', config], {
        cwd: directory,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout?.on('data', (bytes) => (output += String(bytes)));
      child.stderr?.on('data', (bytes) => (output += String(bytes)));
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          child!.once('close', (code, stopped) => resolve({ code, signal: stopped }));
        }
      );
      await waitFor(
        () => {
          if (fs.existsSync(proofFile)) {
            try {
              if ((JSON.parse(fs.readFileSync(proofFile, 'utf8')) as Proof).pid > 0) return true;
            } catch {}
          }
          if (child!.exitCode !== null || child!.signalCode !== null) {
            throw new Error(`Vitest exited before fixture readiness: ${output}`);
          }
          return false;
        },
        20_000,
        'owned fixture readiness'
      );
      proof = JSON.parse(fs.readFileSync(proofFile, 'utf8')) as Proof;
      // Normal completion may already have removed its roots; every tmux call
      // reasserts its private socket at the point of use below.
      ownedGroup = { pid: proof.pid, started: proof.started };
      expect(ownedGroup.started, 'the fixture pane must lead its own process group').not.toBe('');
      if (scenario === 'foreground SIGINT' || scenario === 'foreground SIGTERM') {
        expect(proof.pid).not.toBe(proof.panePid);
        child.kill(scenario === 'foreground SIGINT' ? 'SIGINT' : 'SIGTERM');
      } else if (scenario === 'stale lock SIGTERM') child.kill('SIGTERM');
      else if (scenario === 'SIGINT' || scenario === 'SIGTERM') child.kill(scenario);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Vitest did not exit')), 20_000);
        }),
      ]).finally(() => clearTimeout(timer));
      const expectedCode =
        scenario === 'SIGINT' || scenario === 'foreground SIGINT'
          ? 130
          : scenario === 'SIGTERM' ||
              scenario === 'foreground SIGTERM' ||
              scenario === 'stale lock SIGTERM'
            ? 143
            : scenario === 'normal'
              ? 0
              : 1;
      expect(result, output).toEqual({ code: expectedCode, signal: null });
      if (scenario === 'readiness failure') {
        expect(output).toContain('controlled fixture readiness failure');
        expect(output).not.toContain('E2E fixture survived suite end');
      }
      if (scenario === 'stale lock SIGTERM')
        expect(output).toContain('E2E registry stale lock recovered');
      if (
        scenario === 'timeout' ||
        scenario === 'thrown exit' ||
        scenario === 'thrown exit in allocation'
      ) {
        expect(output).toContain('E2E fixture survived suite end');
      }
      expect(fs.existsSync(proof.socket), output).toBe(false);
      expect(fs.existsSync(proof.socketRoot), output).toBe(false);
      expect(fs.existsSync(proof.root), output).toBe(false);
      try {
        process.kill(-proof.pid, 0);
        throw new Error(`owned fixture group ${proof.pid} survived`);
      } catch (error) {
        expect(error).toMatchObject({ code: 'ESRCH' });
      }
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise<void>((resolve) => child!.once('close', () => resolve()));
      }
      if (!proof && fs.existsSync(proofFile)) {
        proof = JSON.parse(fs.readFileSync(proofFile, 'utf8')) as Proof;
        if (
          proof.pidFile &&
          proof.startFile &&
          fs.existsSync(proof.pidFile) &&
          fs.existsSync(proof.startFile)
        ) {
          const pid = Number(fs.readFileSync(proof.pidFile, 'utf8').trim());
          const started = fs.readFileSync(proof.startFile, 'utf8').trim();
          const leader = groupLeader(pid);
          if (leader?.started === started) ownedGroup = leader;
        }
      }
      if (proof && fs.existsSync(proof.socketRoot)) {
        assertPrivateSocket(proof.socket, proof.socketRoot, env);
        if (fs.existsSync(proof.socket)) {
          stopPrivateTmuxSocket(proof.socket, proof.socketRoot, proof.tmux, env);
        }
        if (ownedGroup) stopOwnedGroups([ownedGroup]);
        fs.rmSync(proof.socketRoot, { recursive: true, force: true });
        fs.rmSync(proof.root, { recursive: true, force: true });
      } else if (ownedGroup) {
        stopOwnedGroups([ownedGroup]);
      }
      if (proof?.registry && fs.existsSync(proof.registry)) {
        removeProbeRegistry(proof.registry);
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  45_000
);
