// Explicit B4 proof: private real native owner + hosted reader, demo Auth/Firestore only.
// No Docker, Hosting deployment, billing, credential import or production-network fallback.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const app = path.join(root, 'extensions/tmt-colab/typescript/app');
const project = 'demo-tmt-colab-hosted';
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  assert.equal(result.error, undefined, `${command} did not start`);
  assert.equal(result.status, 0, `${command} failed (signal ${result.signal ?? 'none'})`);
};
// Keep startup causes in the retained console even after the debug artifact expires.
async function printLogTail(source, name) {
  const fd = openSync(source, 'r');
  let output;
  try {
    const { size } = fstatSync(fd);
    const limit = 64 * 1024;
    const buffer = Buffer.alloc(Math.min(size, limit));
    const bytes = readSync(fd, buffer, 0, buffer.length, Math.max(0, size - limit));
    const lines = buffer
      .subarray(0, bytes)
      .toString('utf8')
      .replace(/\r?\n$/, '')
      .split(/\r?\n/);
    const truncated = size > limit || lines.length > 200;
    output = `[hosted-reader] ${name}: tail (at most 200 lines / 65536 input bytes; truncated=${truncated})\n${lines.slice(-200).join('\n')}\n`;
  } finally {
    closeSync(fd);
  }
  // The original failure is rethrown next; await the pipe so that cannot lose the tail.
  await new Promise((resolve, reject) => {
    process.stderr.write(output, (error) => (error ? reject(error) : resolve()));
  });
}

assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'hosted-reader emulator proof is CI-only: fixed loopback ports belong to its disposable job VM',
);

if (process.argv[2] === '--scenario') {
  assert.equal(process.argv.length, 4);
  assert.equal(process.env.GCLOUD_PROJECT, project);
  for (const name of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'])
    assert.match(process.env[name] ?? '', /^127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  run(
    'corepack',
    [
      'pnpm@10.33.0',
      '--dir',
      'typescript',
      '--filter',
      '@tmt/colab-app',
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.hosted.config.ts',
    ],
    {
      env: { ...process.env, TMT_ACCEPTANCE_BIN_DIR: process.argv[3] },
    },
  );
} else {
  assert.equal(process.argv.length, 2);
  const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
  assert.equal(java.status, 0, 'Java 21 must already be selected');
  assert.match(java.stderr, /version "21[."]/);
  const world = mkdtempSync(path.join(tmpdir(), 'colab-hosted-emulator-'));
  // Disposable CI jobs run this proof serially. Do not probe port 0 and release
  // ephemeral ports before a lengthy build: outbound sockets can take them before
  // Java binds. Firebase owns binding these distinct loopback service ports and
  // fails explicitly if one is occupied; no retry or fallback is added here.
  const emulators = {
    auth: { host: '127.0.0.1', port: 9099 },
    firestore: { host: '127.0.0.1', port: 8080, websocketPort: 9150 },
    hub: { host: '127.0.0.1', port: 4400 },
    ui: { enabled: false },
    singleProjectMode: true,
  };
  try {
    const home = path.join(world, 'home');
    mkdirSync(home);
    const toolEnv = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, 'config'),
      XDG_DATA_HOME: path.join(home, 'data'),
      XDG_STATE_HOME: path.join(home, 'state'),
      CLOUDSDK_CONFIG: path.join(home, 'gcloud'),
      GOOGLE_CLOUD_PROJECT: project,
      XDG_CACHE_HOME: path.join(home, '.cache'),
      FIREBASE_CLI_DISABLE_UPDATE_CHECK: '1',
    };
    delete toolEnv.FIREBASE_CONFIG;
    delete toolEnv.FIREBASE_TOKEN;
    delete toolEnv.GOOGLE_APPLICATION_CREDENTIALS;
    const version = spawnSync('firebase', ['--version'], { encoding: 'utf8', env: toolEnv });
    assert.equal(version.status, 0, 'firebase-tools must already be installed');
    assert.equal(version.stdout.trim(), '15.29.0', 'use pinned firebase-tools 15.29.0');
    const bins = path.join(world, 'bin');
    mkdirSync(path.join(bins, 'examples'), { recursive: true });
    const auth = `${emulators.auth.host}:${emulators.auth.port}`,
      firestore = `${emulators.firestore.host}:${emulators.firestore.port}`;
    const env = {
      ...process.env,
      CARGO_BUILD_JOBS: '2',
      TMT_COLAB_APP_DIR: path.join(app, 'dist'),
      TMT_COLAB_HOSTING_DIR: path.join(app, 'dist-hosted'),
    };
    for (const file of ['dist/index.html', 'dist-hosted/index.html'])
      assert.ok(existsSync(path.join(app, file)), 'build app + hosted assets before the proof');
    // Separate invocations preserve the ordinary Core's production feature set.
    run('cargo', ['build', '--offline', '--locked', '-p', 'tmt-cli', '-p', 'tmt-colab', '--bins'], {
      cwd: path.join(root, 'rust'),
      env,
    });
    const debug = path.join(root, 'rust/target/debug');
    for (const name of ['tmt', 'tmt-colab'])
      copyFileSync(path.join(debug, name), path.join(bins, name));
    // The relocated Colab command reads its release's sibling tree, never checkout bytes.
    cpSync(env.TMT_COLAB_HOSTING_DIR, path.join(bins, 'dist-hosted'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    run(
      'cargo',
      [
        'build',
        '--offline',
        '--locked',
        '-p',
        'tmt-remote',
        '--bin',
        'tmt-remote',
        '--features',
        'test-emulator',
      ],
      { cwd: path.join(root, 'rust'), env },
    );
    copyFileSync(path.join(debug, 'tmt-remote'), path.join(bins, 'remote-emulator'));
    run(
      'cargo',
      ['build', '--offline', '--locked', '-p', 'tmt-remote', '--example', 'compose_hosting'],
      { cwd: path.join(root, 'rust'), env },
    );
    copyFileSync(
      path.join(debug, 'examples/compose_hosting'),
      path.join(bins, 'examples/compose_hosting'),
    );
    // AcceptanceWorld otherwise passes only its private HOME/XDG/PATH. This test-only wrapper
    // carries the exact loopback endpoints to the default-off native emulator build.
    const binary = path.join(bins, 'remote-emulator');
    assert.ok(!/["`$\\\n\r]/.test(binary), 'safe fixed private path');
    writeFileSync(
      path.join(bins, 'tmt-remote'),
      `#!/bin/sh\nexport FIREBASE_AUTH_EMULATOR_HOST=${auth}\nexport FIRESTORE_EMULATOR_HOST=${firestore}\nexec "${binary}" "$@"\n`,
      { mode: 0o700 },
    );
    const cache = path.join(home, '.cache/firebase/emulators');
    mkdirSync(cache, { recursive: true });
    // Reuse only the pinned tools' cached emulator JAR, never any account/config file.
    const jar = 'cloud-firestore-emulator-v1.22.0.jar';
    const cached = path.join(process.env.HOME ?? '', '.cache/firebase/emulators', jar);
    assert.ok(existsSync(cached), 'cache the emulator JAR with pinned firebase-tools first');
    copyFileSync(cached, path.join(cache, jar));
    const config = path.join(world, 'firebase.json');
    const artifacts = path.join(root, 'extensions/tmt-colab/contracts/vectors');
    writeFileSync(
      config,
      JSON.stringify({
        firestore: {
          rules: path.join(artifacts, 'deploy-declaration-v1.firestore.rules'),
          indexes: path.join(artifacts, 'deploy-declaration-v1.firestore.indexes.json'),
        },
        emulators,
      }),
    );
    const scenario = fileURLToPath(import.meta.url);
    assert.ok(!/["`$\\\n\r]/.test(scenario + bins), 'safe fixed command paths');
    const emulatorEnv = {
      ...toolEnv,
      GCLOUD_PROJECT: project,
      CI: 'true',
      FIREBASE_CLI_DISABLE_UPDATE_CHECK: '1',
    };
    emulatorEnv.PLAYWRIGHT_BROWSERS_PATH =
      process.env.PLAYWRIGHT_BROWSERS_PATH ??
      path.join(
        process.env.HOME ?? '',
        process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright',
      );
    delete emulatorEnv.FIREBASE_TOKEN;
    delete emulatorEnv.GOOGLE_APPLICATION_CREDENTIALS;
    // Corepack is a local, already prepared dependency; it need not download into the private HOME.
    emulatorEnv.COREPACK_HOME =
      process.env.COREPACK_HOME ?? path.join(process.env.HOME ?? '', '.cache/node/corepack');
    run(
      'firebase',
      [
        'emulators:exec',
        '--only',
        'auth,firestore',
        '--project',
        project,
        '--config',
        config,
        '--non-interactive',
        `node "${scenario}" --scenario "${bins}"`,
      ],
      { cwd: world, env: emulatorEnv },
    );
  } catch (error) {
    console.error(`[hosted-reader] configured emulator listeners: ${JSON.stringify(emulators)}`);
    // These demo-emulator logs live in the private world, which must still be removed.
    for (const name of ['firebase-debug.log', 'firestore-debug.log']) {
      try {
        const source = path.join(world, name);
        if (existsSync(source)) {
          try {
            await printLogTail(source, name);
          } catch (printError) {
            console.error(`Could not print ${name}: ${String(printError).slice(0, 200)}`);
          }
          const destination = path.join(app, 'test-results/emulators');
          mkdirSync(destination, { recursive: true });
          copyFileSync(source, path.join(destination, name));
        }
      } catch (copyError) {
        console.error(`Could not preserve ${name}: ${String(copyError).slice(0, 200)}`);
      }
    }
    throw error;
  } finally {
    rmSync(world, { recursive: true, force: true });
  }
}
