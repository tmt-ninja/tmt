import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { clarifyBundledLicenses } from './bundled-license-clarification.mjs';

/** Match the pinned Vite licence formatter; collection still belongs to Vite. */
export function licenseText(entries) {
  assert(Array.isArray(entries), 'Vite license metadata must be an array');
  if (entries.length === 0)
    return '# Licenses\n\nThe app does not bundle any dependencies with licenses.\n';
  let text = '# Licenses\n\nThe app bundles dependencies which contain the following licenses:\n';
  for (const entry of entries) {
    assert(
      entry && typeof entry.name === 'string' && typeof entry.version === 'string',
      'Invalid Vite license metadata entry'
    );
    const identifier = entry.identifier ? ` (${entry.identifier})` : '';
    text += `\n## ${entry.name} - ${entry.version}${identifier}\n`;
    if (entry.text) text += `\n${entry.text}\n`;
  }
  return text;
}

/** Keep structured build evidence outside every served/embedded output tree. No policy deps. */
export function bundledLicenseOutput({ metadataFile, sourceRoot }) {
  const jsonName = 'THIRD-PARTY-NOTICES.json';
  // Clear before Vite resolves inputs: resolution can fail before bundler hooks run.
  rmSync(metadataFile, { force: true });
  return {
    name: 'tmt-bundled-license-output',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const asset = bundle[jsonName];
        assert(asset?.type === 'asset', 'Vite bundled license JSON was not emitted');
        const json =
          typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source);
        const entries = clarifyBundledLicenses(sourceRoot, JSON.parse(json));
        const text = licenseText(entries);
        // The JSON exists only in memory and the private evidence directory, never in dist.
        delete bundle[jsonName];
        this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: text });
        mkdirSync(dirname(metadataFile), { recursive: true });
        writeFileSync(metadataFile, JSON.stringify(entries, null, 2));
      },
    },
  };
}
