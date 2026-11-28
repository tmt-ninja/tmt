import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The reviewed license clarifications, one pin per exact package version, each approved where its
 * comment says. A pin is not a fallback for arbitrary missing npm licenses: there are no name
 * patterns and no "any MIT". Each keeps the same checks: the exact name@version, its pnpm v9 lock
 * integrity, its SPDX identifier, and the sha256 of its vendored notice text
 * (`bundled-license-<name>-<version>.txt` beside this file).
 */
export const licensePins = Object.freeze([
  // The 2.3.8 npm gitHead (b3b1287aad81def2e2ae707274b74531b61ddbaf) is unpublished.
  // This is the project's own MIT LICENSE as first added, approved on #2991.
  Object.freeze({
    name: 'react-remove-scroll-bar',
    version: '2.3.8',
    identifier: 'MIT',
    integrity:
      'sha512-9r+yi9+mgU33AKcj6IbT9oRCO78WriSj6t/cF8DWBZJ9aOGPOTEDvdUDz1FwKim7QXWwmHqtdHnRJfhAxEG46Q==',
    commit: '7301c160fda44cb8cf2b9fdfde61efad35736196',
    source:
      'https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE',
    sha256: 'a79aae0c0f21990d9d963bb3c5a79cdcea9a46f8523ba55c58d7fe776b6ebc84',
  }),
  // khroma 2.1.0 ships an MIT `license` file, but its package.json names no SPDX identifier. This is
  // that shipped file, byte for byte, from the integrity-pinned tarball (npm gitHead
  // 4968165afb0d3d09be66497e7985a34f7bfe6d42). The pin supplies `MIT` only while the emitted entry
  // names none. Approved by tmt-infra-lead on #6746.
  Object.freeze({
    name: 'khroma',
    version: '2.1.0',
    identifier: 'MIT',
    identifierWhenMissing: true,
    integrity:
      'sha512-Ls993zuzfayK269Svk9hzpeGUKob/sIgZzyHYdjQoAdQetRKpOLj+k/QQQ/6Qi0Yz65mlROrfd+Ev+1+7dz9Kw==',
    commit: '4968165afb0d3d09be66497e7985a34f7bfe6d42',
    source: 'license, as shipped in the npm tarball of khroma@2.1.0',
    sha256: '66b333b0f66759a0b710459e03f7029abe17f4358114a128d2c972e642961b49',
  }),
  // fastdom 1.0.12 declares MIT but ships no LICENSE. Its npm gitHead
  // (a7b9044d58952b970c8b918dcf0e7c8824ba0ff5) is not on GitHub, the repository has no LICENSE at
  // any ref, and it has no 1.0.12 tag. This is the README's `## License` section, verbatim from
  // "(The MIT License)" through the warranty paragraph, out of README.md in the integrity-pinned
  // tarball. Approved by tmt-infra-lead on #6746 (issuecomment-7084817069).
  Object.freeze({
    name: 'fastdom',
    version: '1.0.12',
    identifier: 'MIT',
    integrity:
      'sha512-LB+xjSTEbjHE1cWsxu+tN2Xqr1kpi+V9aADI7sVM5ZMaXyYGPHULQMzpJMYqOTULK/73pUkWVzzObFRBkPr+hg==',
    commit: 'a7b9044d58952b970c8b918dcf0e7c8824ba0ff5',
    source: 'README.md "## License" section, as shipped in the npm tarball of fastdom@1.0.12',
    sha256: '50c0de64f5cd5e39859b43f7eca7f5843fb3c3d5ac7e34a453e27419ad51e08c',
  }),
]);

/** The pnpm v9 lock integrity of exactly `identity` (`name@version`), or undefined. */
function lockIntegrity(root, identity) {
  // Accept only pnpm's canonical v9 package-resolution record. A changed format fails closed;
  // this reads the one pinned integrity, not a second dependency or license inventory.
  const lock = readFileSync(resolve(root, 'typescript/pnpm-lock.yaml'), 'utf8');
  if (!lock.startsWith("lockfileVersion: '9.0'\n")) return undefined;
  const start = lock.indexOf('\npackages:\n');
  const end = lock.indexOf('\nsnapshots:\n', start + 1);
  const packages = start >= 0 && end > start ? lock.slice(start + 11, end) : undefined;
  const rows = packages?.split(/^  (?=\S)/m).filter((row) => row.startsWith(`${identity}:\n`));
  return rows?.length === 1
    ? /^    resolution: \{integrity: ([A-Za-z0-9+/=-]+)\}$/m.exec(rows[0])?.[1]
    : undefined;
}

/** Fills each reviewed pin's missing notice text, and its missing SPDX identifier where the pin
 * allows; every other entry passes through unchanged for the policy to judge. */
export function clarifyBundledLicenses(root, entries) {
  assert(Array.isArray(entries), 'Bundled dependency metadata must be an array');
  return entries.map((entry) => {
    const pin = licensePins.find(
      (candidate) => entry?.name === candidate.name && entry.version === candidate.version
    );
    if (!pin) return entry;
    const identity = `${pin.name}@${pin.version}`;
    assert(
      lockIntegrity(root, identity) === pin.integrity,
      `Review license clarification lock integrity: ${identity}`
    );
    const named = typeof entry.identifier === 'string' && entry.identifier.trim() !== '';
    assert(
      named ? entry.identifier === pin.identifier : pin.identifierWhenMissing === true,
      `Review license clarification SPDX: ${identity}`
    );
    const bytes = readFileSync(
      new URL(`./bundled-license-${pin.name}-${pin.version}.txt`, import.meta.url)
    );
    assert(
      createHash('sha256').update(bytes).digest('hex') === pin.sha256,
      `License clarification checksum mismatch: ${identity}`
    );
    return {
      ...entry,
      identifier: pin.identifier,
      text: entry.text?.trim() ? entry.text : bytes.toString('utf8').trim(),
    };
  });
}
