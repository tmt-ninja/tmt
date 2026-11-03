import { expect, it } from 'vite-plus/test';
import { trustedActivation } from '../src/ui/trusted-activation.js';

it('refuses synthetic pointer and key activations, including a synthetic click after a synthetic key', () => {
  const click = new Event('click');
  const key = new Event('keydown');
  expect(trustedActivation(click)).toBe(false);
  expect(trustedActivation(click, key)).toBe(false);
});
