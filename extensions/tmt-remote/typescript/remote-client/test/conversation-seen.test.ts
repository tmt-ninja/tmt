import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  conversationSeen,
  conversationUnread,
  type ConversationScope,
} from '../src/conversation-seen.js';
import type { ConversationPage } from '../src/conversations.js';
const scope: ConversationScope = {
  machineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  viewerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  memberId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const newest: ConversationPage = {
  viewerId: scope.viewerId,
  member: 'active',
  items: [],
  nextBefore: null,
  changePosition: 'opaque_New',
  changedSince: { count: 1, more: false },
};
const visible = { newest: true, documentVisible: true, panelVisible: true };
function storage() {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
}
test('a late final remains unread until the newest conversation is opened, without comparing tokens', () => {
  const saved = storage();
  const seen = conversationSeen(saved);
  assert.deepEqual(conversationUnread(seen.read(scope), { count: 0, more: false }), {
    state: 'unknown',
  });
  assert.equal(
    seen.markVisibleNewest(scope, { ...newest, changePosition: 'z_earlier' }, visible),
    true,
  );
  const old = seen.read(scope);
  assert.equal(old.position, 'z_earlier');
  const late = { ...newest, changePosition: 'a_later', changedSince: { count: 1, more: false } };
  assert.deepEqual(conversationUnread(old, late.changedSince), {
    state: 'known',
    count: 1,
    more: false,
  });
  assert.equal(seen.read(scope).position, 'z_earlier', 'fetching alone changes nothing');
  assert.equal(seen.markVisibleNewest(scope, late, visible), true);
  assert.equal(seen.read(scope).position, 'a_later', 'opaque values are echoed, never ordered');
  assert.deepEqual(conversationUnread(seen.read(scope), { count: 0, more: false }), {
    state: 'known',
    count: 0,
    more: false,
  });
});
test('hidden documents, closed panels and older pages never advance seen', () => {
  const saved = storage();
  const seen = conversationSeen(saved);
  for (const state of [
    { ...visible, newest: false },
    { ...visible, documentVisible: false },
    { ...visible, panelVisible: false },
  ])
    assert.equal(seen.markVisibleNewest(scope, newest, state), false);
  assert.equal(saved.rows.size, 0);
});
test('counts retain Core more and unknown; viewer, machine and member keys stay isolated', () => {
  const seen = conversationSeen(storage());
  seen.markVisibleNewest(scope, newest, visible);
  const baseline = seen.read(scope);
  assert.deepEqual(conversationUnread(baseline, { count: 50, more: true }), {
    state: 'known',
    count: 50,
    more: true,
  });
  assert.deepEqual(conversationUnread(baseline, 'unknown'), { state: 'unknown' });
  for (const key of ['viewerId', 'machineId', 'memberId'])
    assert.equal(
      seen.read({ ...scope, [key]: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }).position,
      null,
    );
  assert.equal(
    seen.markVisibleNewest({ ...scope, viewerId: scope.memberId }, newest, visible),
    false,
  );
});
test('storage refusal never fabricates a baseline or zero count', () => {
  const seen = conversationSeen({
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  });
  assert.equal(seen.markVisibleNewest(scope, newest, visible), false);
  assert.deepEqual(conversationUnread(seen.read(scope), { count: 0, more: false }), {
    state: 'unknown',
  });
  assert.deepEqual(
    conversationUnread(conversationSeen(undefined).read(scope), { count: 0, more: false }),
    { state: 'unknown' },
  );
});
