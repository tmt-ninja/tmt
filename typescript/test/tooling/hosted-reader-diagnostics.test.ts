import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const wrapper = readFileSync(
  new URL('../../../extensions/tmt-colab/scripts/hosted-reader-emulator.mjs', import.meta.url),
  'utf8'
);

// Execute the unchanged owner wrapper; only its external tools/native build outputs are fixtures.
function qualify(options: {
  status: number;
  missing?: boolean;
  blockCopy?: boolean;
  longLogs?: boolean;
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'tmt-hosted-diagnostics-'));
  try {
    const repo = path.join(root, 'repo');
    const script = path.join(repo, 'extensions/tmt-colab/scripts/hosted-reader-emulator.mjs');
    const app = path.join(repo, 'extensions/tmt-colab/typescript/app');
    const tools = path.join(root, 'tools');
    const home = path.join(root, 'home');
    const temp = path.join(root, 'temp');
    const log = path.join(root, 'world.json');
    for (const directory of [
      path.dirname(script),
      tools,
      temp,
      path.join(home, '.cache/firebase/emulators'),
    ])
      mkdirSync(directory, { recursive: true });
    writeFileSync(script, wrapper);
    writeFileSync(
      path.join(home, '.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar'),
      'test-owned jar'
    );
    for (const file of ['dist/index.html', 'dist-hosted/index.html']) {
      const target = path.join(app, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'test-owned assets');
    }
    for (const name of ['tmt', 'tmt-colab', 'tmt-remote', 'examples/compose_hosting']) {
      const target = path.join(repo, 'rust/target/debug', name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'test-owned native build output');
    }
    const tool = (name: string, source: string) =>
      writeFileSync(path.join(tools, name), `#!${process.execPath}\n${source}`, { mode: 0o755 });
    tool('java', `process.stderr.write('openjdk version "21.0.1"\\n');`);
    tool('cargo', 'process.exit(0);');
    tool(
      'firebase',
      `
const fs = require('node:fs');
const path = require('node:path');
if (process.argv[2] === '--version') { console.log('15.29.0'); process.exit(0); }
if (process.argv[2] !== 'emulators:exec') process.exit(99);
if (process.env.GCLOUD_PROJECT !== 'demo-tmt-colab-hosted') process.exit(98);
for (const key of ['FIREBASE_CONFIG', 'FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS']) {
  if (process.env[key] !== undefined) process.exit(97);
}
const config = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--config') + 1], 'utf8'));
fs.writeFileSync(process.env.CALL_LOG, JSON.stringify({ cwd: process.cwd(), home: process.env.HOME, emulators: config.emulators, remoteWrapper: fs.readFileSync(path.join(process.cwd(), 'bin/tmt-remote'), 'utf8'), executions: fs.existsSync(process.env.CALL_LOG) ? JSON.parse(fs.readFileSync(process.env.CALL_LOG, 'utf8')).executions + 1 : 1 }));
fs.writeFileSync('firebase-debug.log', process.env.LONG_LOGS === '1'
  ? Array.from({ length: 250 }, (_, i) => 'firebase-line-' + i).join('\\n')
  : 'demo firebase log');
if (process.env.MISSING_LOG !== '1') fs.writeFileSync('firestore-debug.log', process.env.LONG_LOGS === '1'
  ? 'x'.repeat(128 * 1024) + 'FIRESTORE-TAIL'
  : 'demo firestore log');
fs.writeFileSync('unrelated.log', 'do not retain');
process.exit(Number(process.env.PROOF_STATUS));
`
    );
    if (options.blockCopy) {
      mkdirSync(path.join(app, 'test-results'), { recursive: true });
      writeFileSync(path.join(app, 'test-results/emulators'), 'blocked destination');
    }
    const result = spawnSync(process.execPath, [script], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        PATH: `${tools}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin:/bin`,
        HOME: home,
        GITHUB_ACTIONS: 'true',
        TMPDIR: temp,
        CALL_LOG: log,
        PROOF_STATUS: String(options.status),
        MISSING_LOG: options.missing ? '1' : '0',
        LONG_LOGS: options.longLogs ? '1' : '0',
        FIREBASE_CONFIG: 'must be removed',
        FIREBASE_TOKEN: 'test-only sentinel, not a credential',
        GOOGLE_APPLICATION_CREDENTIALS: 'must be removed',
      },
    });
    expect(result.error).toBeUndefined();
    const world = JSON.parse(readFileSync(log, 'utf8')) as {
      cwd: string;
      home: string;
      emulators: Record<string, unknown>;
      remoteWrapper: string;
      executions: number;
    };
    expect(world.emulators).toEqual({
      auth: { host: '127.0.0.1', port: 9099 },
      firestore: { host: '127.0.0.1', port: 8080, websocketPort: 9150 },
      hub: { host: '127.0.0.1', port: 4400 },
      ui: { enabled: false },
      singleProjectMode: true,
    });
    expect(world.remoteWrapper).toContain('export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099\n');
    expect(world.remoteWrapper).toContain('export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080\n');
    expect(world.executions).toBe(1);
    expect(world.home).not.toBe(home);
    expect(existsSync(world.cwd)).toBe(false);
    expect(readdirSync(temp)).toEqual([]);
    const destination = path.join(app, 'test-results/emulators');
    const files =
      existsSync(destination) && !options.blockCopy ? readdirSync(destination).sort() : [];
    const contents = files.map((name) => readFileSync(path.join(destination, name), 'utf8'));
    return { status: result.status, stderr: result.stderr, files, contents };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('hosted reader failure diagnostics', () => {
  it('refuses local execution before starting tools or creating a world', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tmt-hosted-local-refusal-'));
    try {
      const script = new URL(
        '../../../extensions/tmt-colab/scripts/hosted-reader-emulator.mjs',
        import.meta.url
      );
      const result = spawnSync(process.execPath, [script.pathname], {
        encoding: 'utf8',
        timeout: 10_000,
        env: { PATH: '/no-external-tools', HOME: root, TMPDIR: root, GITHUB_ACTIONS: 'false' },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('hosted-reader emulator proof is CI-only');
      expect(result.stderr).not.toContain('Java 21 must already be selected');
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves exactly the two demo logs on failure while removing the private world', () => {
    const result = qualify({ status: 7 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('firebase failed (signal none)');
    expect(result.stderr).toContain('[hosted-reader] configured emulator listeners:');
    expect(result.files).toEqual(['firebase-debug.log', 'firestore-debug.log']);
    expect(result.contents).toEqual(['demo firebase log', 'demo firestore log']);
  });

  it('prints a bounded line and byte tail without truncating the preserved logs', () => {
    const result = qualify({ status: 7, longLogs: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('firebase failed (signal none)');
    expect(result.stderr).toContain(
      '[hosted-reader] firebase-debug.log: tail (at most 200 lines / 65536 input bytes; truncated=true)'
    );
    expect(result.stderr).not.toContain('firebase-line-49\n');
    expect(result.stderr).toContain('firebase-line-50\n');
    expect(result.stderr).toContain('firebase-line-249\n');
    expect(result.stderr).toContain(
      '[hosted-reader] firestore-debug.log: tail (at most 200 lines / 65536 input bytes; truncated=true)'
    );
    expect(result.stderr).toContain('FIRESTORE-TAIL\n');
    expect(Buffer.byteLength(result.stderr)).toBeLessThan(75 * 1024);
    expect(result.contents[0]).toContain('firebase-line-0\n');
    expect(result.contents[1]).toHaveLength(128 * 1024 + 'FIRESTORE-TAIL'.length);
  });

  it('does not retain emulator logs after success', () => {
    const result = qualify({ status: 0 });
    expect(result.status).toBe(0);
    expect(result.files).toEqual([]);
    expect(result.stderr).not.toContain('[hosted-reader]');
  });

  it('admits a missing log without masking the original failure', () => {
    const result = qualify({ status: 7, missing: true });
    expect(result.status).toBe(1);
    expect(result.files).toEqual(['firebase-debug.log']);
    expect(result.stderr).toContain('firebase failed (signal none)');
  });

  it('reports copy errors and still rethrows the original error and removes the world', () => {
    const result = qualify({ status: 7, blockCopy: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Could not preserve firebase-debug.log:');
    expect(result.stderr).toContain('Could not preserve firestore-debug.log:');
    expect(result.stderr).toContain(
      'AssertionError [ERR_ASSERTION]: firebase failed (signal none)'
    );
  });
});
