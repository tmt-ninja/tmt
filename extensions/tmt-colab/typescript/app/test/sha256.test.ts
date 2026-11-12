import { expect, it } from 'vite-plus/test';
import { sha256Hex } from '../src/sha256.js';

// The standalone binder's synchronous SHA-256 (#6157) agrees with the platform's, across the block
// and length-field boundaries and on a runtime-sized input.
const subtle = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

it('matches crypto.subtle at every padding boundary and on a large input', async () => {
  expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 600_001]) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = (i * 131 + length) & 255;
    expect(sha256Hex(bytes), String(length)).toBe(await subtle(bytes));
  }
});
