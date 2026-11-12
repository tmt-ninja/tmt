import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite-plus';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { bundledLicenseOutput, licenseText } from '../../scripts/bundled-license-output.mjs';
import { acceptedLicenses, verifyBundledLicenses } from '../../scripts/bundled-license-policy.mjs';
import { fileURLToPath } from 'node:url';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(identifier = 'MIT') {
  const root = mkdtempSync(join(tmpdir(), 'tmt-bundle-notices-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules/shipped'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules/shipped/package.json'),
    JSON.stringify({
      name: 'shipped',
      version: '1.0.0',
      license: identifier,
      main: 'index.js',
    })
  );
  writeFileSync(join(root, 'node_modules/shipped/index.js'), 'export const value = 42;');
  writeFileSync(
    join(root, 'node_modules/shipped/LICENSE'),
    'Copyright (c) 2026 Fixture authors\nPermission is hereby granted.'
  );
  writeFileSync(join(root, 'entry.js'), "export { value } from 'shipped';");
  return root;
}

function compile(root: string, structured: boolean) {
  return build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: structured
      ? [
          bundledLicenseOutput({
            metadataFile: join(root, 'private/bundled.json'),
            sourceRoot: root,
          }),
        ]
      : [],
    build: {
      outDir: join(root, structured ? 'after' : 'before'),
      license: { fileName: structured ? 'THIRD-PARTY-NOTICES.json' : 'THIRD-PARTY-NOTICES.txt' },
      lib: { entry: join(root, 'entry.js'), formats: ['es'], fileName: 'bundle' },
    },
  });
}

describe('Vite bundled notice evidence', () => {
  it('preserves the real Vite TXT bytes and keeps JSON out of the emitted tree', async () => {
    const root = fixture();
    await compile(root, false);
    await compile(root, true);
    expect(readFileSync(join(root, 'after/THIRD-PARTY-NOTICES.txt'))).toEqual(
      readFileSync(join(root, 'before/THIRD-PARTY-NOTICES.txt'))
    );
    expect(readdirSync(join(root, 'after')).sort()).toEqual([
      'THIRD-PARTY-NOTICES.txt',
      'bundle.mjs',
    ]);
    const entries = JSON.parse(readFileSync(join(root, 'private/bundled.json'), 'utf8'));
    expect(entries).toEqual([
      {
        name: 'shipped',
        version: '1.0.0',
        identifier: 'MIT',
        text: 'Copyright (c) 2026 Fixture authors\nPermission is hereby granted.',
      },
    ]);
  });

  it('names a disallowed emitted package at the separate policy step, not during build', async () => {
    const root = fixture('GPL-3.0-only');
    await compile(root, true);
    const source = fileURLToPath(new URL('../../../', import.meta.url));
    expect(acceptedLicenses(source).has('GPL-3.0-only')).toBe(false);
    expect(() => verifyBundledLicenses(source, join(root, 'private/bundled.json'))).toThrow(
      'Disallowed SPDX license: shipped@1.0.0: GPL-3.0-only'
    );
  });

  it('clears stale private evidence when input parsing fails', async () => {
    const root = fixture();
    await compile(root, true);
    writeFileSync(join(root, 'entry.js'), 'export const = ;');
    await expect(compile(root, true)).rejects.toThrow();
    expect(() => readFileSync(join(root, 'private/bundled.json'))).toThrow();
  });

  it('preserves the pinned empty-closure formatting', () => {
    expect(licenseText([])).toBe(
      '# Licenses\n\nThe app does not bundle any dependencies with licenses.\n'
    );
    expect(() => licenseText(null)).toThrow('must be an array');
  });
});
