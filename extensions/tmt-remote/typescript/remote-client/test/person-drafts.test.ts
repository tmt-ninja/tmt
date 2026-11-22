import { expect, it, vi } from 'vite-plus/test';
import { readPersonDrafts, writePersonDraft } from '../src/person-drafts.js';

it('keeps unsent names scoped to the Remote and removes restored drafts', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  writePersonDraft(storage, 'remote-a', 'member', { baseline: 'Guest', value: 'Draft' });
  expect(readPersonDrafts(storage, 'remote-a').get('member')).toEqual({
    baseline: 'Guest',
    value: 'Draft',
  });
  expect(readPersonDrafts(storage, 'remote-b').size).toBe(0);
  writePersonDraft(storage, 'remote-a', 'member', undefined);
  expect(readPersonDrafts(storage, 'remote-a').size).toBe(0);
});

it('keeps unsent Ops words per place within the bound, back after a reload on the same device, and forgets them when the session changes', async () => {
  const values = new Map<string, string>();
  // A tab quota: a write past it is refused, as the browser does.
  let quota = Infinity;
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > quota) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key: string) => void values.delete(key),
  });
  const load = async () => {
    vi.resetModules();
    return import('../src/ops-composer-slot.js');
  };
  const KEY = 'tmt-ops-drafts-v2';
  values.set('tmt-ops-drafts-v1', '[["m0","from an older build"]]');
  const slot = await load();
  const stored = () =>
    JSON.parse(values.get(KEY) ?? '{"drafts":[]}') as { device?: string; drafts: string[][] };
  // Until the page knows this browser's device, words stay in their boxes only.
  slot.keepDraft('early', 'typed before the device was read');
  expect(values.has(KEY)).toBe(false);
  slot.draftsFor('device-a');
  expect(stored()).toEqual({
    device: 'device-a',
    drafts: [['early', 'typed before the device was read']],
  });
  expect(values.has('tmt-ops-drafts-v1')).toBe(false);
  for (let at = 0; at <= slot.DRAFT_PLACES; at++) slot.keepDraft(`m${at}`, `words ${at}`);
  // Past the bound, the place typed in longest ago goes first.
  expect(slot.hasDraft('early')).toBe(false);
  expect(slot.hasDraft('m0')).toBe(false);
  expect(stored().drafts).toHaveLength(slot.DRAFT_PLACES);
  expect(stored().drafts.at(-1)).toEqual([`m${slot.DRAFT_PLACES}`, `words ${slot.DRAFT_PLACES}`]);
  // A draft past the size bound stays in its box (and the rail's mark), but is not kept.
  slot.keepDraft('m1', 'x'.repeat(slot.DRAFT_BYTES + 1));
  expect(slot.hasDraft('m1')).toBe(true);
  expect(stored().drafts.some(([key]) => key === 'm1')).toBe(false);
  // Blank words are no draft.
  slot.keepDraft('m2', '  ');
  expect(slot.hasDraft('m2')).toBe(false);
  // A refused write keeps the newest words that fit, not none.
  quota = 400;
  slot.keepDraft('newest', 'the latest words');
  expect(stored().drafts.length).toBeGreaterThan(0);
  expect(stored().drafts.length).toBeLessThan(slot.DRAFT_PLACES);
  expect(stored().drafts.at(-1)).toEqual(['newest', 'the latest words']);
  quota = Infinity;
  // A reload holds them unshown until the page reads the same device.
  const again = await load();
  expect(again.hasDraft('newest')).toBe(false);
  again.keepDraft('since', 'typed after the reload');
  again.draftsFor('device-a');
  expect(again.hasDraft('newest')).toBe(true);
  expect(again.hasDraft('since')).toBe(true);
  // Under another pairing a reload shows none, and the other device's words are dropped.
  const other = await load();
  other.draftsFor('device-b');
  expect(other.hasDraft('newest')).toBe(false);
  expect(values.has(KEY)).toBe(false);
  // The session changing forgets them all; no pairing at all is the same.
  other.keepDraft('k', 'words');
  other.forgetDrafts();
  expect(other.hasDraft('k')).toBe(false);
  expect(values.has(KEY)).toBe(false);
  vi.unstubAllGlobals();
});
