import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import parseSpdx from 'spdx-expression-parse';
import { assertDependencyNotices, readBoundedFile } from './native-artifact-policy.mjs';
import { runPackedCommand } from './packed-command.mjs';
import { clarifyBundledLicenses } from './bundled-license-clarification.mjs';

/** Rust and browser distributions share the reviewed policy, including whole WITH terms. */
export function acceptedLicenses(root, runner = runPackedCommand) {
  const accepted = JSON.parse(
    runner(
      'python3',
      [
        '-c',
        'import json,sys,tomllib; print(json.dumps(tomllib.load(open(sys.argv[1], "rb"))["accepted"]))',
        resolve(root, 'rust/about.toml'),
      ],
      { cwd: root, env: process.env }
    )
  );
  assert(
    Array.isArray(accepted) &&
      accepted.length > 0 &&
      accepted.every((term) => typeof term === 'string' && term.trim() === term),
    'License policy must contain nonempty SPDX terms'
  );
  for (const term of accepted) {
    const node = parseSpdx(term);
    assert(!node.conjunction, 'Accepted license policy entries must be individual SPDX terms');
  }
  return new Set(accepted);
}

function permits(node, accepted) {
  if (node.conjunction === 'and')
    return permits(node.left, accepted) && permits(node.right, accepted);
  if (node.conjunction === 'or')
    return permits(node.left, accepted) || permits(node.right, accepted);
  const term = `${node.license}${node.plus ? '+' : ''}${node.exception ? ` WITH ${node.exception}` : ''}`;
  return accepted.has(term);
}

/** Only Vite's emitted closure is input here, never the installed dev-tool inventory. */
export function assertBundledLicenses(entries, accepted) {
  assert(Array.isArray(entries), 'Bundled dependency metadata must be an array');
  const identities = new Set();
  for (const entry of entries) {
    assert(entry && typeof entry === 'object', 'Invalid bundled dependency metadata entry');
    const { name, version, identifier, text } = entry;
    assert(typeof name === 'string' && name.trim(), 'Bundled dependency name is missing');
    assert(
      typeof version === 'string' && version.trim(),
      `Bundled dependency version is missing: ${name}`
    );
    const identity = `${name}@${version}`;
    assert(!identities.has(identity), `Duplicate bundled dependency: ${identity}`);
    identities.add(identity);
    assert(
      typeof identifier === 'string' && identifier.trim(),
      `Missing SPDX license: ${identity}`
    );
    let expression;
    try {
      expression = parseSpdx(identifier);
    } catch (cause) {
      throw new Error(`Invalid SPDX license: ${identity}: ${identifier}`, { cause });
    }
    assert(permits(expression, accepted), `Disallowed SPDX license: ${identity}: ${identifier}`);
    assert(typeof text === 'string' && text.trim(), `Missing license notice text: ${identity}`);
    try {
      assertDependencyNotices(text);
    } catch (cause) {
      throw new Error(`Invalid license notice text: ${identity}: ${cause.message}`, { cause });
    }
  }
  return entries.length;
}

/** Read bounded local evidence only. Missing output is a failure, never a registry lookup. */
export function verifyBundledLicenses(root, metadataFile) {
  const accepted = acceptedLicenses(root);
  const entries = JSON.parse(readBoundedFile(metadataFile, 16 * 1024 * 1024));
  return assertBundledLicenses(clarifyBundledLicenses(root, entries), accepted);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(
    process.argv.length === 4,
    'Usage: bundled-license-policy.mjs <source-root> <metadata.json>'
  );
  const count = verifyBundledLicenses(resolve(process.argv[2]), resolve(process.argv[3]));
  console.log(`Verified licenses for ${count} bundled dependencies`);
}
