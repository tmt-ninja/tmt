import { expect, test } from 'vite-plus/test';
import { DOWNLOAD_COOLDOWN_MS, downloadCooldown } from '../src/download-cooldown.js';

// #6094: after a Cancel the frame's download requests are ignored for a fixed time.
test('a Cancel holds frame requests off for the cool-down, then admits them again', () => {
  let now = 1000;
  const gate = downloadCooldown(() => now);
  expect(gate.admits()).toBe(true);
  gate.cancelled();
  expect(gate.admits()).toBe(false);
  now += DOWNLOAD_COOLDOWN_MS - 1;
  expect(gate.admits()).toBe(false);
  now += 1;
  expect(gate.admits()).toBe(true);
});

test('requests during the cool-down neither restart nor extend it', () => {
  let now = 0;
  const gate = downloadCooldown(() => now);
  gate.cancelled();
  for (let step = 0; step < DOWNLOAD_COOLDOWN_MS; step += 250) {
    now = step;
    expect(gate.admits()).toBe(false);
  }
  now = DOWNLOAD_COOLDOWN_MS;
  expect(gate.admits()).toBe(true);
});

test('a new render or page clears the cool-down', () => {
  let now = 0;
  const gate = downloadCooldown(() => now);
  gate.cancelled();
  now = 10;
  gate.clear();
  expect(gate.admits()).toBe(true);
});
