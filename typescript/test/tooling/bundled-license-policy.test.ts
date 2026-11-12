import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  acceptedLicenses,
  assertBundledLicenses,
  verifyBundledLicenses,
} from '../../scripts/bundled-license-policy.mjs';
import {
  clarifyBundledLicenses,
  scrollBarLicense,
} from '../../scripts/bundled-license-clarification.mjs';

const source = fileURLToPath(new URL('../../../', import.meta.url));
const accepted = acceptedLicenses(source);
const entry = {
  name: '@example/bundled',
  version: '1.2.3',
  identifier: 'MIT',
  text: 'Copyright (c) 2026 Example authors\nPermission is hereby granted...',
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tmt-license-'));
  roots.push(root);
  mkdirSync(join(root, 'rust'));
  writeFileSync(join(root, 'rust/about.toml'), 'accepted = ["MIT"]\n');
  const metadata = join(root, 'bundled.json');
  writeFileSync(metadata, JSON.stringify([entry]));
  return { root, metadata };
}

describe('redistributed npm license policy', () => {
  it('uses only the version/integrity-pinned, checksummed upstream clarification', () => {
    const { root } = fixture();
    mkdirSync(join(root, 'typescript'));
    const lock = `lockfileVersion: '9.0'\n\npackages:\n\n  ${scrollBarLicense.name}@${scrollBarLicense.version}:\n    resolution: {integrity: ${scrollBarLicense.integrity}}\n\nsnapshots:\n`;
    writeFileSync(join(root, 'typescript/pnpm-lock.yaml'), lock);
    const missing = {
      name: scrollBarLicense.name,
      version: scrollBarLicense.version,
      identifier: 'MIT',
    };
    const [filled] = clarifyBundledLicenses(root, [missing]) as { text: string }[];
    expect(filled.text).toContain('MIT License\n\nCopyright (c) 2025 Anton Korzunov');
    expect(assertBundledLicenses([filled], accepted)).toBe(1);
    expect(clarifyBundledLicenses(root, [filled])).toEqual([filled]);
    for (const changed of [
      { ...missing, version: '2.3.9' },
      { ...missing, name: 'unreviewed' },
    ]) {
      expect(() =>
        assertBundledLicenses(clarifyBundledLicenses(root, [changed]), accepted)
      ).toThrow('Missing license notice text');
    }
    expect(() =>
      clarifyBundledLicenses(root, [{ ...missing, identifier: 'GPL-3.0-only' }])
    ).toThrow('Review license clarification SPDX');
    writeFileSync(
      join(root, 'typescript/pnpm-lock.yaml'),
      lock.replace(scrollBarLicense.integrity, 'sha512-CHANGED==')
    );
    expect(() => clarifyBundledLicenses(root, [missing])).toThrow(
      'Review license clarification lock integrity'
    );
  });

  it('rejects altered clarification bytes rather than accepting an unreviewed text', async () => {
    const { root } = fixture();
    mkdirSync(join(root, 'typescript'));
    writeFileSync(
      join(root, 'typescript/pnpm-lock.yaml'),
      readFileSync(join(source, 'typescript/pnpm-lock.yaml'))
    );
    const module = join(root, 'bundled-license-clarification.mjs');
    writeFileSync(
      module,
      readFileSync(join(source, 'typescript/scripts/bundled-license-clarification.mjs'))
    );
    writeFileSync(
      join(root, 'bundled-license-react-remove-scroll-bar-2.3.8.txt'),
      'MIT License\nCopyright another author'
    );
    const { clarifyBundledLicenses: altered } = await import(pathToFileURL(module).href);
    expect(() =>
      altered(root, [
        { name: scrollBarLicense.name, version: scrollBarLicense.version, identifier: 'MIT' },
      ])
    ).toThrow('License clarification checksum mismatch');
  });
  it('reads the canonical reviewed Rust allowlist, including multiline TOML', () => {
    expect([...accepted]).toEqual([
      'MIT',
      'Apache-2.0',
      'Unicode-3.0',
      'ISC',
      'BSD-3-Clause',
      'CDLA-Permissive-2.0',
      'Zlib',
      '0BSD',
    ]);
    const { root } = fixture();
    writeFileSync(join(root, 'rust/about.toml'), 'accepted = [\n "ISC", # policy\n "MIT",\n]\n');
    expect([...acceptedLicenses(root)]).toEqual(['ISC', 'MIT']);
  });

  it.each([
    'MIT',
    'MIT OR GPL-3.0-only',
    '(MIT OR GPL-3.0-only) AND Apache-2.0',
    'MIT AND (ISC OR GPL-3.0-only)',
  ])('accepts a satisfiable expression: %s', (identifier) => {
    expect(assertBundledLicenses([{ ...entry, identifier }], accepted)).toBe(1);
  });

  it.each([
    'MIT AND GPL-3.0-only',
    'GPL-3.0-only',
    'BSD-2-Clause',
    'MIT WITH LLVM-exception',
    'GPL-2.0+',
    'LicenseRef-unreviewed',
  ])('rejects an unsatisfied expression: %s', (identifier) => {
    expect(() => assertBundledLicenses([{ ...entry, identifier }], accepted)).toThrow(
      /Disallowed SPDX license.*@example\/bundled@1.2.3/
    );
  });

  it('evaluates WITH and plus as whole terms, without inheriting base-license approval', () => {
    const identifier = 'Apache-2.0 WITH LLVM-exception';
    expect(() => assertBundledLicenses([{ ...entry, identifier }], accepted)).toThrow('Disallowed');
    expect(assertBundledLicenses([{ ...entry, identifier }], new Set([identifier]))).toBe(1);
    expect(
      assertBundledLicenses([{ ...entry, identifier: 'GPL-2.0+' }], new Set(['GPL-2.0+']))
    ).toBe(1);
  });

  it.each(['MIT OR', 'made-up', 'MIT/Apache-2.0', 'https://example.test/license'])(
    'rejects invalid SPDX instead of guessing: %s',
    (identifier) => {
      expect(() => assertBundledLicenses([{ ...entry, identifier }], accepted)).toThrow(
        'Invalid SPDX'
      );
    }
  );

  it.each([
    [{ identifier: undefined }, 'Missing SPDX'],
    [{ identifier: '' }, 'Missing SPDX'],
    [{ text: undefined }, 'Missing license notice text'],
    [{ text: '   ' }, 'Missing license notice text'],
    [{ text: 'Copyright <year> <copyright holders>' }, 'placeholder attribution'],
    [{ name: '' }, 'name is missing'],
    [{ version: '' }, 'version is missing'],
  ])('rejects incomplete emitted evidence %#', (change, message) => {
    expect(() => assertBundledLicenses([{ ...entry, ...change }], accepted)).toThrow(message);
  });

  it('accepts an explicitly empty emitted closure but rejects malformed or duplicate evidence', () => {
    expect(assertBundledLicenses([], accepted)).toBe(0);
    expect(() => assertBundledLicenses({}, accepted)).toThrow('must be an array');
    expect(() => assertBundledLicenses([null], accepted)).toThrow('Invalid bundled');
    expect(() => assertBundledLicenses([entry, entry], accepted)).toThrow('Duplicate bundled');
  });

  it('checks emitted packages only; installed unbundled tools do not become redistribution', () => {
    const { root, metadata } = fixture();
    mkdirSync(join(root, 'node_modules/tool'), { recursive: true });
    writeFileSync(join(root, 'node_modules/tool/package.json'), '{"license":"GPL-3.0-only"}');
    expect(verifyBundledLicenses(root, metadata)).toBe(1);
    writeFileSync(metadata, JSON.stringify([{ ...entry, identifier: 'GPL-3.0-only' }]));
    expect(() => verifyBundledLicenses(root, metadata)).toThrow('Disallowed');
  });

  it('fails missing and malformed local output without network or package-manager fallback', () => {
    const { root, metadata } = fixture();
    const trap = join(root, 'offline.cjs');
    const attempts = join(root, 'network-attempts');
    writeFileSync(
      trap,
      `
const fs = require('node:fs');
const deny = () => { fs.appendFileSync(${JSON.stringify(attempts)}, 'blocked\\n'); throw new Error('NETWORK BLOCKED'); };
for (const name of ['http', 'https', 'net', 'tls', 'dgram']) {
  const module = require('node:' + name);
  for (const key of ['request', 'get', 'connect', 'createConnection', 'createSocket']) {
    if (module[key]) module[key] = deny;
  }
}
globalThis.fetch = deny;
const cp = require('node:child_process');
const spawnSync = cp.spawnSync;
cp.spawnSync = (command, args, options) => {
  if (command !== 'python3' || args[0] !== '-c' || args[2] !== ${JSON.stringify(join(root, 'rust/about.toml'))}) return deny();
  return spawnSync(command, args, options);
};
for (const key of ['spawn', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = deny;
require('node:module').syncBuiltinESMExports();
`
    );
    const run = (args: string[]) =>
      spawnSync(process.execPath, ['--require', trap, ...args], {
        encoding: 'utf8',
        timeout: 10_000,
      });
    // A real blocked attempt proves the trap is armed before the checker runs.
    expect(run(['-e', "require('node:https').get('https://example.invalid')"]).stderr).toContain(
      'NETWORK BLOCKED'
    );
    expect(readFileSync(attempts, 'utf8')).toBe('blocked\n');
    rmSync(attempts);
    const checker = join(source, 'typescript/scripts/bundled-license-policy.mjs');
    expect(run([checker, root, metadata]).status).toBe(0);
    writeFileSync(metadata, JSON.stringify([{ ...entry, identifier: undefined, text: undefined }]));
    const incomplete = run([checker, root, metadata]);
    expect(incomplete.status).toBe(1);
    expect(incomplete.stderr).toContain('Missing SPDX');
    writeFileSync(metadata, '{');
    expect(run([checker, root, metadata]).status).toBe(1);
    rmSync(metadata);
    expect(run([checker, root, metadata]).stderr).toContain('ENOENT');
    expect(() => readFileSync(attempts)).toThrow();
  });
});
