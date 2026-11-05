#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertNoCoreDatabase } from './native-database-layout.mjs';
import { parseArgs } from 'node:util';
import { generateNativeBootstrap } from './native-bootstrap.mjs';
import { selectNativeArtifact } from './native-artifact-policy.mjs';
import { runPackedCommand } from './packed-command.mjs';
import { assertMacOsArchitecture } from './native-runtime-proof.mjs';
import { bootstrapTools } from './native-bootstrap-proof.mjs';
import { CLI_NAMESPACE, LEGACY_CLI_NAMESPACE, readCliLayout } from './native-install-layout.mjs';
import {
  hasMovedInstallerHandoff,
  requireMovedInstallerProtocol,
} from './native-upgrade-proof.mjs';

const { values } = parseArgs({
  options: Object.fromEntries(
    ['manifest', 'archive', 'target', 'skill'].map((name) => [name, { type: 'string' }])
  ),
});
for (const name of ['manifest', 'archive', 'target', 'skill']) {
  assert(values[name], `--${name} is required`);
}
const metadata = selectNativeArtifact(values.manifest, values.archive, values.target, 'cli', {
  release: true,
});
const architecture = { arm64: 'aarch64', x64: 'x86_64' }[process.arch];
const platform = { darwin: 'apple-darwin', linux: 'unknown-linux-musl' }[process.platform];
assert(architecture && platform, 'Unsupported verification host');
assert.equal(values.target, `${architecture}-${platform}`, 'Use matching-host release artifacts');
const script = await generateNativeBootstrap(values.manifest, path.dirname(values.archive));
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tmt bootstrap's ")));
try {
  const tools = bootstrapTools(root);
  const old = path.join(root, 'old npm bin');
  const prefix = path.join(root, 'native prefix');
  const state = path.join(root, 'app state');
  fs.mkdirSync(old);
  const oldBytes = '#!/bin/sh\nexit 99\n';
  fs.writeFileSync(path.join(old, 'tmt'), oldBytes, { mode: 0o755 });
  const installer = path.join(root, 'installer.sh');
  fs.writeFileSync(installer, script, { mode: 0o600 });
  const env = {
    HOME: root,
    TMPDIR: root,
    TMT_HOME: state,
    LANG: 'C',
    PATH: [old, tools].join(path.delimiter),
    TMT_FIXTURE_VERSION: metadata.version,
    TMT_FIXTURE_NAME: metadata.name,
    TMT_FIXTURE_MANIFEST: path.resolve(values.manifest),
    TMT_FIXTURE_ARCHIVE: path.resolve(values.archive),
  };
  const options = { cwd: root, env, timeoutMs: 30_000 };
  const bootstrap = (flags = []) =>
    runPackedCommand('/bin/sh', [installer, '--prefix', prefix, ...flags], options);
  const first = bootstrap(['--no-skill']);
  assert.match(first, /PATH may still select another installation/);
  assert.match(first, /npm uninstall -g tmux-team/);
  assert(!fs.existsSync(state), 'Binary-only bootstrap must not create application state');
  const executable = path.join(prefix, 'bin/tmt');
  assertMacOsArchitecture(executable, values.target, options);
  const run = (args) => runPackedCommand(executable, args, options);
  assert.equal(run(['--version']).trim(), metadata.version);
  const layout = readCliLayout(prefix);
  const moved = hasMovedInstallerHandoff(new URL('../../', import.meta.url));
  assert.equal(layout.namespace, moved ? CLI_NAMESPACE : LEGACY_CLI_NAMESPACE);
  if (moved) {
    requireMovedInstallerProtocol(executable, options);
    assert(
      !fs.existsSync(path.join(prefix, LEGACY_CLI_NAMESPACE)),
      'Fresh install created a former prefix.'
    );
    for (const command of ['tmt', 'tmux-team'])
      assert.equal(
        fs.readlinkSync(path.join(prefix, 'bin', command)),
        `../${CLI_NAMESPACE}/current/tmt`
      );
  }
  const pointer = layout.current;
  const initial = fs.readlinkSync(pointer);
  bootstrap();
  assert.equal(fs.readlinkSync(pointer), initial, 'Repeat bootstrap must not create a release');
  assert.equal(run(['learn', '--skill']), fs.readFileSync(values.skill, 'utf8'));
  const installedSkill = path.join(root, '.agents/skills/tmt/SKILL.md');
  const installedInboxSkill = path.join(root, '.agents/skills/tmt-inbox/SKILL.md');
  const installedOfficeSkill = path.join(root, '.agents/skills/tmt-office/SKILL.md');
  assert.equal(fs.readFileSync(installedSkill, 'utf8'), fs.readFileSync(values.skill, 'utf8'));
  assert.equal(
    fs.readFileSync(installedInboxSkill, 'utf8'),
    fs.readFileSync(new URL('../../skills/tmt-inbox/SKILL.md', import.meta.url), 'utf8')
  );
  assert(!fs.existsSync(installedOfficeSkill), 'CLI bootstrap must preserve core-only guidance');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(state, 'skill-installations.json'), 'utf8')),
    {
      version: 1,
      targets: [path.join(root, '.agents/skills/tmt'), path.join(root, '.agents/skills/tmt-inbox')],
    }
  );
  assertNoCoreDatabase(state, 'Skill setup must not open SQLite');
  bootstrap(['--pin']);
  const receipt = readCliLayout(prefix).receipt;
  assert.equal(receipt.pinned_version, metadata.version);
  // A pinned CLI decides before any discovery, so the whole run succeeds with no network (#6137).
  const pinned = JSON.parse(withoutNetwork(executable, ['upgrade', '--json'], options));
  assert.equal(pinned.skippedPinned, true, 'Pinned managed executable must update without network');
  for (const row of pinned.products.slice(1)) {
    assert.equal(row.status, 'notChecked', `Pinned upgrade checked ${row.product}`);
    assert.equal(row.reason, 'cliPinned', `Pinned upgrade gave ${row.product} another reason`);
  }
  assert.equal(fs.readFileSync(path.join(old, 'tmt'), 'utf8'), oldBytes);
  // No tmt on PATH at all: a first install, with nothing to replace.
  const fresh = runPackedCommand('/bin/sh', [installer, '--no-skill'], {
    ...options,
    env: { ...env, PATH: tools },
  });
  assert.match(fresh, /\/\.local\/bin is not in PATH yet/);
  assert.doesNotMatch(fresh, /another installation|npm uninstall/);
  const defaultExecutable = path.join(root, '.local/bin/tmt');
  assertMacOsArchitecture(defaultExecutable, values.target, options);
  assert.equal(
    runPackedCommand(defaultExecutable, ['--version'], options).trim(),
    metadata.version
  );
  assert(
    !fs.readdirSync(root).some((name) => name.startsWith('tmt-bootstrap.')),
    'Bootstrap staging leaked'
  );
  console.log(
    `Verified actual native bootstrap: ${metadata.version} (${values.target}), isolated curl fixture, no Node/Rust runtime PATH`
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * Runs the command where every outbound connection fails, and proves that first with a probe.
 * The denial is fail-closed: a host with no working wrapper fails the proof, never skips it.
 */
function withoutNetwork(executable, args, options) {
  const probe = [
    '-e',
    "const s = require('node:net').connect({ host: '192.0.2.1', port: 443 });" +
      "s.setTimeout(5000, () => process.exit(2)); s.on('connect', () => process.exit(3));" +
      "s.on('error', (e) => { console.log(e.code); process.exit(0); });",
  ];
  const failures = [];
  for (const [wrap, denial] of offlineWrappers(options.env)) {
    try {
      const code = runPackedCommand(...wrap(process.execPath, probe), options).trim();
      assert.equal(code, denial, `Network probe was not denied: ${code}`);
    } catch (error) {
      failures.push(error.message.split('\n')[0]);
      continue;
    }
    return runPackedCommand(...wrap(executable, args), options);
  }
  assert.fail(`No network-denying wrapper works on this host: ${failures.join('; ')}`);
}

/** Candidate wrappers as [wrap(executable, args) -> [file, argv], expected probe error code]. */
function offlineWrappers(env) {
  if (process.platform === 'darwin') {
    const profile = '(version 1)(allow default)(deny network*)';
    return [[(file, argv) => ['/usr/bin/sandbox-exec', ['-p', profile, file, ...argv]], 'EPERM']];
  }
  // Ubuntu 24.04 may refuse unprivileged user namespaces; the runner's sudo then makes the
  // network namespace and setpriv drops back to the same user before the command runs.
  const pairs = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  const user = [`--reuid=${process.getuid()}`, `--regid=${process.getgid()}`, '--clear-groups'];
  return [
    [
      (file, argv) => [
        '/usr/bin/unshare',
        ['--user', '--map-current-user', '--net', file, ...argv],
      ],
      'ENETUNREACH',
    ],
    [
      (file, argv) => [
        '/usr/bin/sudo',
        [
          '-n',
          '/usr/bin/unshare',
          '--net',
          '/usr/bin/setpriv',
          ...user,
          '/usr/bin/env',
          '-i',
          ...pairs,
          file,
          ...argv,
        ],
      ],
      'ENETUNREACH',
    ],
  ];
}
