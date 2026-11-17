import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultNativeExecutable = fileURLToPath(
  new URL('../../../rust/target/debug/tmt', import.meta.url)
);

const checkedBinaries = new Map();
const rebuild = 'cargo build --locked --manifest-path rust/Cargo.toml -p tmt-cli --bin tmt';

function fileKey(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

function checkDefaultBinary(executable, stat) {
  const key = fileKey(stat);
  if (!checkedBinaries.has(key)) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmt-cli-selection-'));
    let outcome;
    try {
      const home = path.join(root, 'home');
      fs.mkdirSync(home);
      const result = spawnSync(executable, ['config', 'show', '--json'], {
        cwd: root,
        env: { HOME: home, TMT_HOME: path.join(root, 'tmt'), PATH: '/usr/bin:/bin' },
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      let document;
      try {
        document = JSON.parse(result.stdout || result.stderr);
      } catch {
        // A malformed response cannot establish that this is an ordinary build.
      }
      if (document?.error?.code === 'TEST_ISOLATION') {
        outcome = `The default test executable has TEST_ISOLATION enabled. Rebuild it with: ${rebuild}`;
      } else if (result.error || result.status !== 0 || !document || typeof document !== 'object') {
        outcome = `Could not verify the default test executable ${executable}: ${result.error?.message ?? `exit ${result.status}, invalid config output`}.`;
      } else {
        outcome = null;
      }
      if (fileKey(fs.statSync(executable)) !== key) {
        throw new Error(
          `Default test executable changed while it was being checked: ${executable}.`
        );
      }
      checkedBinaries.set(key, outcome);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  const failure = checkedBinaries.get(key);
  if (failure) throw new Error(failure);
}

// Test infrastructure only. Production commands never inspect these selectors.
export function resolveCliExecutables(env = process.env) {
  const cli = resolveDescriptor(env.TMT_TEST_CLI, 'TMT_TEST_CLI');
  const peer =
    env.TMT_TEST_PEER_CLI === undefined
      ? cli
      : resolveDescriptor(env.TMT_TEST_PEER_CLI, 'TMT_TEST_PEER_CLI');
  return Object.freeze({ cli, peer });
}

function resolveDescriptor(serialized, label) {
  let value;
  try {
    value =
      serialized === undefined
        ? { executable: defaultNativeExecutable, args: [] }
        : JSON.parse(serialized);
  } catch {
    throw new Error(`${label} must be a JSON executable descriptor.`);
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'executable' && key !== 'args') ||
    typeof value.executable !== 'string' ||
    !path.isAbsolute(value.executable) ||
    value.executable.includes('\0') ||
    !Array.isArray(value.args) ||
    !value.args.every((arg) => typeof arg === 'string' && !arg.includes('\0'))
  ) {
    throw new Error(
      `${label} requires an absolute executable and a string-array args prefix; no other keys are accepted.`
    );
  }
  let stat;
  try {
    stat = fs.statSync(value.executable);
    if (!stat.isFile()) throw new Error('not a regular file');
    fs.accessSync(value.executable, fs.constants.X_OK);
  } catch (error) {
    const hint =
      serialized === undefined
        ? ' Build it with cargo build --manifest-path rust/Cargo.toml --locked, or set an explicit test executable descriptor.'
        : '';
    throw new Error(
      `${label} executable is unavailable or not executable: ${value.executable}.${hint}`,
      {
        cause: error,
      }
    );
  }
  if (serialized === undefined) checkDefaultBinary(value.executable, stat);
  return Object.freeze({ executable: value.executable, args: Object.freeze([...value.args]) });
}
