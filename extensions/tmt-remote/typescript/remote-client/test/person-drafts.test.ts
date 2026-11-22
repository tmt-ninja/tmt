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

it('keeps unsent Ops words per place within the bound, back after a reload, and forgets them when the session changes', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  });
  const load = async () => {
    vi.resetModules();
    return import('../src/ops-composer-slot.js');
  };
  const slot = await load();
  const stored = () => JSON.parse(values.get('tmt-ops-drafts-v1') ?? '[]') as [string, string][];
  for (let at = 0; at <= slot.DRAFT_PLACES; at++) slot.keepDraft(`m${at}`, `words ${at}`);
  // Past the bound, the place typed in longest ago goes first.
  expect(slot.hasDraft('m0')).toBe(false);
  expect(stored()).toHaveLength(slot.DRAFT_PLACES);
  expect(stored().at(-1)).toEqual([`m${slot.DRAFT_PLACES}`, `words ${slot.DRAFT_PLACES}`]);
  // A draft past the size bound stays in its box (and the rail's mark), but is not kept.
  slot.keepDraft('m1', 'x'.repeat(slot.DRAFT_BYTES + 1));
  expect(slot.hasDraft('m1')).toBe(true);
  expect(stored().some(([key]) => key === 'm1')).toBe(false);
  // Blank words are no draft.
  slot.keepDraft('m2', '  ');
  expect(slot.hasDraft('m2')).toBe(false);
  // A reload reads them back.
  const again = await load();
  expect(again.hasDraft(`m${slot.DRAFT_PLACES}`)).toBe(true);
  expect(again.hasDraft('m1')).toBe(false);
  // The session changing forgets them all.
  again.forgetDrafts();
  expect(again.hasDraft(`m${slot.DRAFT_PLACES}`)).toBe(false);
  expect(values.has('tmt-ops-drafts-v1')).toBe(false);
  vi.unstubAllGlobals();
});
