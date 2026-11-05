// Exercise actual wasm-bindgen output and the same Rust renderer natively.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const [native, glue, vectorPath] = process.argv.slice(2);
assert.ok(native && glue && vectorPath, 'usage: node wasm-parity.mjs <native> <glue> <vector>');
const vector = JSON.parse(readFileSync(vectorPath, 'utf8'));
const wasm = createRequire(import.meta.url)(glue);
const requests = [{registry:true}, ...vector.cases.map((c) => c.input)];
const child = spawnSync(native, {input: requests.map((r) => JSON.stringify(r)).join('\n') + '\n', encoding:'utf8', maxBuffer: 16 * 1024 * 1024});
assert.equal(child.status, 0, child.stderr);
const outputs = child.stdout.trim().split('\n').map((line) => JSON.parse(line));
assert.equal(outputs.length, requests.length);
assert.deepEqual(JSON.parse(wasm.registry()), vector.registry);
assert.deepEqual(outputs[0], {ok: vector.registry});
for (const [i, c] of vector.cases.entries()) {
  let got;
  try { got = {ok: JSON.parse(wasm.render(c.input.component, c.input.props_json, c.input.width, c.input.height))}; }
  catch (e) { got = {error: JSON.parse(String(e)).code}; }
  const expected = structuredClone(c.expected);
  if (expected.ok?.cells_rle) {
    const cells = [];
    for (const [count, cell] of expected.ok.cells_rle) {
      assert.ok(Number.isSafeInteger(count) && count > 0 && cells.length + count <= 32_768);
      for (let n = 0; n < count; n++) cells.push(cell);
    }
    assert.equal(cells.length, expected.ok.width * expected.ok.height);
    delete expected.ok.cells_rle;
    expected.ok.cells = cells;
  }
  assert.deepEqual(outputs[i + 1], expected, `native ${c.name}`);
  assert.deepEqual(got, expected, `wasm ${c.name}`);
}
console.log(`registry v${vector.registry.version}: ${vector.cases.length} native/wasm vector cases pass`);
