import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The 2.3.8 npm gitHead (b3b1287aad81def2e2ae707274b74531b61ddbaf) is unpublished.
// This is the project's own MIT LICENSE as first added, approved on #2991.
export const scrollBarLicense = Object.freeze({
  name: 'react-remove-scroll-bar',
  version: '2.3.8',
  identifier: 'MIT',
  integrity:
    'sha512-9r+yi9+mgU33AKcj6IbT9oRCO78WriSj6t/cF8DWBZJ9aOGPOTEDvdUDz1FwKim7QXWwmHqtdHnRJfhAxEG46Q==',
  commit: '7301c160fda44cb8cf2b9fdfde61efad35736196',
  source:
    'https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE',
  sha256: 'a79aae0c0f21990d9d963bb3c5a79cdcea9a46f8523ba55c58d7fe776b6ebc84',
});

/** This one reviewed clarification is not a fallback for arbitrary missing npm licenses. */
export function clarifyBundledLicenses(root, entries) {
  assert(Array.isArray(entries), 'Bundled dependency metadata must be an array');
  const pin = scrollBarLicense;
  return entries.map((entry) => {
    if (entry?.name !== pin.name || entry.version !== pin.version) return entry;
    const identity = `${pin.name}@${pin.version}`;
    // Accept only pnpm's canonical v9 package-resolution record. A changed format fails closed;
    // this reads the one pinned integrity, not a second dependency or license inventory.
    const lock = readFileSync(resolve(root, 'typescript/pnpm-lock.yaml'), 'utf8');
    const start = lock.indexOf('\npackages:\n');
    const end = lock.indexOf('\nsnapshots:\n', start + 1);
    const packages = start >= 0 && end > start ? lock.slice(start + 11, end) : undefined;
    const rows = packages?.split(/^  (?=\S)/m).filter((row) => row.startsWith(`${identity}:\n`));
    const integrity =
      rows?.length === 1
        ? /^    resolution: \{integrity: ([A-Za-z0-9+/=-]+)\}$/m.exec(rows[0])?.[1]
        : undefined;
    assert(
      lock.startsWith("lockfileVersion: '9.0'\n") && integrity === pin.integrity,
      `Review license clarification lock integrity: ${identity}`
    );
    assert(entry.identifier === pin.identifier, `Review license clarification SPDX: ${identity}`);
    const bytes = readFileSync(
      new URL('./bundled-license-react-remove-scroll-bar-2.3.8.txt', import.meta.url)
    );
    assert(
      createHash('sha256').update(bytes).digest('hex') === pin.sha256,
      `License clarification checksum mismatch: ${identity}`
    );
    return entry.text?.trim() ? entry : { ...entry, text: bytes.toString('utf8').trim() };
  });
}
