import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { binary, encodeBinary } from '../src/bytes.js';

const fromBase64 = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
const toBase64 = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
afterEach(() => {
  vi.restoreAllMocks();
  if (fromBase64) Object.defineProperty(Uint8Array, 'fromBase64', fromBase64);
  else Reflect.deleteProperty(Uint8Array, 'fromBase64');
  if (toBase64) Object.defineProperty(Uint8Array.prototype, 'toBase64', toBase64);
  else Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
});
function fallbackDecode() {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    configurable: true,
    ...fromBase64,
    value: undefined,
  });
}

const failure = (run: () => unknown) => {
  try {
    run();
    return null;
  } catch (error) {
    return { name: (error as Error).name, message: (error as Error).message };
  }
};

describe('canonical binary codecs', () => {
  for (const native of [true, false]) {
    it(`decodes canonical vectors with native codecs ${native}`, () => {
      if (!native) fallbackDecode();
      for (const bytes of [[], [0], [255], [0, 255], [251, 255, 255], [1, 2, 3, 4]]) {
        const encoded = Buffer.from(bytes).toString('base64url');
        expect(binary(encoded, bytes.length, bytes.length)).toEqual(new Uint8Array(bytes));
      }
    });
    it(`retains refusal names and messages with native codecs ${native}`, () => {
      if (!native) fallbackDecode();
      const invalid = { name: 'Error', message: 'Invalid colab-v1 value or proof' };
      for (const encoded of ['AB', 'A_', 'AAB', 'AA_', 'Zg=', '_w==', '+w', '/w', 'AA\n'])
        expect(failure(() => binary(encoded, 32))).toEqual(invalid);
      for (const encoded of ['A', 'AAAAA'])
        expect(failure(() => binary(encoded, 32))).toEqual(failure(() => atob(encoded)));
      expect(failure(() => binary('AAAA', 2))).toEqual(invalid);
      expect(failure(() => binary('AA', 32, 2))).toEqual(invalid);
      expect(failure(() => binary('AAAA', 0))).toEqual(invalid);
    });
  }
  it('encodes all tail lengths with native and fallback codecs', () => {
    for (const native of [true, false]) {
      if (!native)
        Object.defineProperty(Uint8Array.prototype, 'toBase64', {
          configurable: true,
          ...toBase64,
          value: undefined,
        });
      for (const length of [0, 1, 2, 3, 8191, 8192, 8193]) {
        const bytes = new Uint8Array(length).map((_, index) => index % 256);
        expect(encodeBinary(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
      }
    }
  });
  it('decodes 3 MiB without callback conversion, binary strings or canonical re-encoding', () => {
    const bytes = Buffer.alloc(3 * 1024 * 1024, 251);
    const encoded = bytes.toString('base64url');
    fallbackDecode();
    const callback = vi.spyOn(Uint8Array, 'from');
    const decodeString = vi.spyOn(globalThis, 'atob');
    const encodeString = vi.spyOn(globalThis, 'btoa');
    const decoded = binary(encoded, bytes.length, bytes.length);
    expect(Buffer.from(decoded).equals(bytes)).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    expect(decodeString).not.toHaveBeenCalled();
    expect(encodeString).not.toHaveBeenCalled();
  });
});
