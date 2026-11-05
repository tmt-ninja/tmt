// Pin both independently delivered artifacts and their combined gzip budget.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
const [directory, vectorPath] = process.argv.slice(2);
assert.ok(directory && vectorPath, 'usage: node artifact-size.mjs <bindgen-dir> <vector>');
const expected = JSON.parse(readFileSync(vectorPath, 'utf8')).artifacts;
const sizes = (name) => {
  const bytes = readFileSync(path.join(directory, name));
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
};
const wasm = sizes('tmt_tui_wasm_bg.wasm');
const glue = sizes('tmt_tui_wasm.js');
console.log(JSON.stringify({ wasm, glue, combined_gzip: wasm.gzip + glue.gzip }));
assert.deepEqual(wasm, expected.wasm, 'wasm size changed; review and update the vector');
assert.deepEqual(glue, expected.glue, 'glue size changed; review and update the vector');
assert.equal(expected.combined_gzip_limit, 524_288, 'the approved cap cannot silently change');
assert.ok(wasm.gzip + glue.gzip <= expected.combined_gzip_limit, 'wasm renderer exceeds cap');
