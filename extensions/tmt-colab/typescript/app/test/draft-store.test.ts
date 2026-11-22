import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import type { ComposerEdit } from '../src/components/message-composer-edit.js';
import {
  DRAFTS_PER_PAGE,
  DraftSession,
  LocalDraftStore,
  pendingMessageStore,
  persistable,
} from '../src/draft-store.js';
import { draftKey, titleKey } from '../src/keyring.js';
import { COMMENT_BYTES } from '../src/thread-records.js';
import { savedDrafts, unconfirmedDrafts } from '../src/saved-drafts.js';

const stored = new Map<string, unknown>();
let unavailable = false;
vi.mock('../src/storage.js', () => ({
  record: async (key: string, ...values: unknown[]) => {
    if (unavailable) throw new Error('Storage unavailable');
    if (values.length) stored.set(key, structuredClone(values[0]));
    else return structuredClone(stored.get(key));
  },
}));
beforeEach(() => {
  stored.clear();
  unavailable = false;
  vi.stubGlobal('navigator', {
    locks: { request: async (_name: string, action: () => unknown) => action() },
  });
});
afterEach(() => vi.useRealTimers());

const RECORD = 'drafts:space:device:page';
const store = (space = 'space', device = 'device') => new LocalDraftStore(space, device);
const edit = (value: string, extra: Partial<ComposerEdit> = {}): ComposerEdit => ({
  value,
  ...extra,
});

it('keeps interrupted message text encrypted until its own recovery entry is cleared', async () => {
  const pending = pendingMessageStore(store(), 'page');
  const chat = await pending.retain('chat', edit('Chat recovery', { edited: true }));
  const comment = await pending.retain('comment', edit('Comment recovery', { edited: true }));
  expect(chat).toMatch(/^unconfirmed:chat:/);
  expect(comment).toMatch(/^unconfirmed:comment:/);
  expect(JSON.stringify(stored.get(RECORD))).not.toContain('recovery');
  expect((await store().load('page'))?.get(chat!)).toEqual(edit('Chat recovery', { edited: true }));
  await pending.clear(chat!);
  const restored = await store().load('page');
  expect(restored?.has(chat!)).toBe(false);
  expect(restored?.get(comment!)).toEqual(edit('Comment recovery', { edited: true }));
  unavailable = true;
  expect(await pending.retain('chat', edit('Must not send'))).toBeUndefined();
});

it('refuses a new interrupted message instead of evicting earlier unconfirmed sends', async () => {
  const pending = pendingMessageStore(store(), 'page');
  const keys: string[] = [];
  for (let i = 0; i < DRAFTS_PER_PAGE; i++) {
    const key = await pending.retain('chat', edit(`Message ${i}`, { edited: true }));
    expect(key).toBeDefined();
    keys.push(key!);
  }
  expect(await pending.retain('chat', edit('Overflow', { edited: true }))).toBeUndefined();
  expect(await store().apply('page', new Map([['chat', edit('A new draft')]]))).toBe(false);
  const restored = await store().load('page');
  expect(restored?.size).toBe(DRAFTS_PER_PAGE);
  for (const key of keys) expect(restored?.has(key)).toBe(true);
});

it('shows recovered chat and comment sends in their own surfaces without treating them as ordinary drafts', () => {
  const drafts = new Map([
    ['unconfirmed:chat:one', edit('A chat', { edited: true })],
    ['unconfirmed:comment:two', edit('A comment', { edited: true })],
    ['chat', edit('Current draft', { edited: true })],
  ]);
  expect(unconfirmedDrafts(drafts, 'chat')).toEqual([
    { key: 'unconfirmed:chat:one', text: 'A chat', unconfirmed: true },
  ]);
  expect(unconfirmedDrafts(drafts, 'comment')).toEqual([
    { key: 'unconfirmed:comment:two', text: 'A comment', unconfirmed: true },
  ]);
  expect(savedDrafts(drafts, [])).toEqual([]);
});

it('encrypts drafts with a key kept apart from title hints and restores exact bytes', async () => {
  const body = 'Line one\nLine 🐈 <script>two</script>';
  const mention = {
    key: { machine: 'machine-1', agent: 'agent-1' },
    range: { start: 0, end: 6 },
  };
  expect(
    await store().apply('page', new Map([['{"exact":"q"}', edit(body, { mentions: [mention] })]])),
  ).toBe(true);
  const sealed = stored.get(RECORD);
  expect(sealed).toEqual({ nonce: expect.any(String), ciphertext: expect.any(String) });
  expect(JSON.stringify(sealed)).not.toContain('Line');
  const loaded = await store().load('page');
  expect(loaded?.get('{"exact":"q"}')).toEqual(edit(body, { mentions: [mention] }));
  // Separate purposes keep separate non-extractable key records.
  const draft = await draftKey('device');
  expect(draft.extractable).toBe(false);
  expect(stored.has('draft-key:device')).toBe(true);
  expect(stored.has('title-key:device')).toBe(false);
  await titleKey('device');
  expect(stored.get('title-key:device')).not.toBe(stored.get('draft-key:device'));
});

it('binds a record to space, device and page even if it is copied', async () => {
  await store().apply('page', new Map([['chat', edit('Scoped')]]));
  const value = stored.get(RECORD);
  stored.set('draft-key:other', structuredClone(stored.get('draft-key:device')));
  for (const [space, device, page] of [
    ['other', 'device', 'page'],
    ['space', 'other', 'page'],
    ['space', 'device', 'other'],
  ]) {
    stored.set(`drafts:${space}:${device}:${page}`, structuredClone(value));
    expect((await store(space, device).load(page))?.size).toBe(0);
  }
  expect((await store().load('page'))?.get('chat')).toEqual(edit('Scoped'));
});

it('ignores malformed, tampered or future-version records and replaces them on the next write', async () => {
  await store().apply('page', new Map([['chat', edit('Good')]]));
  const good = stored.get(RECORD) as { nonce: string; ciphertext: string };
  for (const bad of [
    null,
    7,
    { ...good, extra: true },
    { ...good, nonce: 'AA' },
    { ...good, ciphertext: 'AAAA' },
  ]) {
    stored.set(RECORD, bad);
    expect((await store().load('page'))?.size).toBe(0);
  }
  stored.set(RECORD, good);
  expect((await store().load('page'))?.get('chat')).toEqual(edit('Good'));
  // A readable record with a wrong version or entry shape is not partly trusted.
  const key = await draftKey('device');
  const { seal } = await import('../src/local-seal.js');
  const scope = ['tmt-colab-drafts-v1', 'space', 'device', 'page'];
  const plain = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  for (const value of [
    { v: 2, drafts: [] },
    { v: 1, drafts: [{ target: 'a', edit: { value: 1 } }] },
    { v: 1, drafts: [{ target: 'a', edit: { value: 'x', extra: 1 } }] },
    {
      v: 1,
      drafts: [
        {
          target: 'a',
          edit: {
            value: 'x',
            mentions: [{ key: { machine: 'm', agent: 'a' }, range: { start: 0, end: 9 } }],
          },
        },
      ],
    },
    {
      v: 1,
      drafts: [
        { target: 'a', edit: { value: 'x' } },
        { target: 'a', edit: { value: 'y' } },
      ],
    },
    {
      v: 1,
      drafts: Array.from({ length: DRAFTS_PER_PAGE + 1 }, (_, i) => ({
        target: `t${i}`,
        edit: { value: 'x' },
      })),
    },
  ]) {
    stored.set(RECORD, await seal(key, scope, plain(value)));
    expect((await store().load('page'))?.size).toBe(0);
  }
  expect(await store().apply('page', new Map([['chat', edit('Fresh')]]))).toBe(true);
  expect([...(await store().load('page'))!.keys()]).toEqual(['chat']);
});

it('reports unavailable storage honestly and keeps the last good record', async () => {
  await store().apply('page', new Map([['chat', edit('Kept')]]));
  unavailable = true;
  expect(await store().load('page')).toBeUndefined();
  expect(await store().apply('page', new Map([['chat', edit('Lost')]]))).toBe(false);
  unavailable = false;
  expect((await store().load('page'))?.get('chat')).toEqual(edit('Kept'));
});

it('bounds drafts per page and keeps the newest', async () => {
  const many = new Map<string, ComposerEdit | null>();
  for (let i = 0; i < DRAFTS_PER_PAGE + 3; i++) many.set(`t${i}`, edit(`draft ${i}`));
  expect(await store().apply('page', many)).toBe(true);
  const loaded = await store().load('page');
  expect(loaded?.size).toBe(DRAFTS_PER_PAGE);
  expect(loaded?.has('t0')).toBe(false);
  expect(loaded?.has(`t${DRAFTS_PER_PAGE + 2}`)).toBe(true);
  // Updating an old draft makes it the newest, so a later overflow drops another one.
  await store().apply('page', new Map([['t3', edit('updated')]]));
  await store().apply('page', new Map([['new', edit('new')]]));
  const after = await store().load('page');
  expect(after?.get('t3')?.value).toBe('updated');
  expect(after?.has('t4')).toBe(false);
  await store().apply('page', new Map([['t3', null]]));
  expect((await store().load('page'))?.has('t3')).toBe(false);
});

it('refuses an oversized or malformed draft without touching stored ones', async () => {
  await store().apply('page', new Map([['chat', edit('Safe')]]));
  const before = structuredClone(stored.get(RECORD));
  expect(await store().apply('page', new Map([['big', edit('x'.repeat(COMMENT_BYTES + 1))]]))).toBe(
    false,
  );
  expect(
    await store().apply(
      'page',
      new Map([
        [
          'm',
          edit('abc', {
            mentions: [{ key: { machine: 'm', agent: 'a' }, range: { start: 2, end: 9 } }],
          }),
        ],
      ]),
    ),
  ).toBe(false);
  expect(stored.get(RECORD)).toEqual(before);
});

it('persists only deliberate nonblank drafts', () => {
  expect(persistable(edit(''))).toBe(false);
  expect(persistable(edit('  \n'))).toBe(false);
  expect(persistable(edit('@Agent ', { edited: false }))).toBe(false);
  expect(persistable(edit('@Agent hi', { edited: true }))).toBe(true);
  expect(persistable(edit('plain'))).toBe(true);
});

it('coalesces writes, skips clearing what was never saved, and retries after a failure', async () => {
  vi.useFakeTimers();
  const apply = vi.fn(
    async (_page: string, _changes: ReadonlyMap<string, ComposerEdit | null>) => true,
  );
  const failed = vi.fn();
  const session = new DraftSession({ load: async () => new Map(), apply }, 'page', failed);
  session.set('a', edit('one'));
  session.set('a', edit('two'));
  session.set('never-saved', edit('  '));
  expect(apply).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  expect(apply).toHaveBeenCalledTimes(1);
  expect([...apply.mock.calls[0][1]]).toEqual([['a', edit('two')]]);
  expect(failed).toHaveBeenLastCalledWith(false);

  apply.mockResolvedValueOnce(false);
  session.set('a', null);
  await vi.advanceTimersByTimeAsync(500);
  expect(failed).toHaveBeenLastCalledWith(true);
  session.set('b', edit('newer'));
  await session.flush();
  expect(failed).toHaveBeenLastCalledWith(false);
  // The failed removal is retried together with the newer change.
  expect([...apply.mock.calls.at(-1)![1]].sort()).toEqual([
    ['a', null],
    ['b', edit('newer')],
  ]);
  await session.close();
  session.set('c', edit('after close'));
  await vi.advanceTimersByTimeAsync(500);
  expect(apply.mock.calls.flatMap((call) => [...call[1].keys()])).not.toContain('c');
});

it('learns what is already stored so clearing it is written', async () => {
  vi.useFakeTimers();
  const apply = vi.fn(async () => true);
  const session = new DraftSession(
    { load: async () => new Map([['old', edit('stored')]]), apply },
    'page',
    () => {},
  );
  await session.load();
  session.set('old', edit(''));
  await session.flush();
  expect(apply).toHaveBeenCalledTimes(1);
});

it('persists v1 mention bytes without creator provenance and restores them as manual', async () => {
  const draft: ComposerEdit = {
    value: '@agent text',
    edited: true,
    mentions: [
      {
        key: { machine: 'machine', agent: 'agent' },
        range: { start: 0, end: 6 },
        defaultCreator: true,
      },
    ],
  };
  expect(await store().apply('page', new Map([['chat', draft]]))).toBe(true);
  expect((await store().load('page'))?.get('chat')).toEqual({
    ...draft,
    mentions: [
      {
        key: { machine: 'machine', agent: 'agent' },
        range: { start: 0, end: 6 },
      },
    ],
  });
  const { open } = await import('../src/local-seal.js');
  const bytes = await open(
    await draftKey('device'),
    ['tmt-colab-drafts-v1', 'space', 'device', 'page'],
    stored.get(RECORD) as { nonce: string; ciphertext: string },
    3 * 1024 * 1024,
  );
  expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
    v: 1,
    drafts: [
      {
        target: 'chat',
        edit: {
          value: '@agent text',
          edited: true,
          mentions: [{ key: { machine: 'machine', agent: 'agent' }, range: { start: 0, end: 6 } }],
        },
      },
    ],
  });
  expect(draft.mentions?.[0].defaultCreator).toBe(true);
});

it('keeps an edited pending creator reference without losing an existing v1 paired draft', async () => {
  const { seal } = await import('../src/local-seal.js');
  const previous = {
    value: '@old Kept',
    edited: true,
    mentions: [
      { key: { machine: 'old-machine', agent: 'old-agent' }, range: { start: 0, end: 4 } },
    ],
  };
  const bytes = new TextEncoder().encode(
    JSON.stringify({ v: 1, drafts: [{ target: 'old', edit: previous }] }),
  );
  stored.set(
    RECORD,
    await seal(await draftKey('device'), ['tmt-colab-drafts-v1', 'space', 'device', 'page'], bytes),
  );
  expect((await store().load('page'))?.get('old')).toEqual(previous);
  const pending = {
    value: '@creator My draft',
    edited: true,
    mentions: [{ key: { agent: 'creator-id' }, range: { start: 0, end: 8 }, defaultCreator: true }],
  } as ComposerEdit;
  expect(await store().apply('page', new Map([['chat', pending]]))).toBe(true);
  const loaded = await store().load('page');
  expect(loaded?.get('old')).toEqual(previous);
  expect(loaded?.get('chat')).toEqual({
    ...pending,
    mentions: [{ key: { agent: 'creator-id' }, range: { start: 0, end: 8 } }],
  });
});

it('the existing reader rejects a whole composer record containing a typed block entry', async () => {
  const { seal } = await import('../src/local-seal.js');
  const entries = [
    { target: 'chat', edit: { value: 'keep this chat' } },
    { target: 'block:id', edit: { base: 'Plan', value: '', generation: 'edit-1' } },
  ];
  stored.set(
    RECORD,
    await seal(
      await draftKey('device'),
      ['tmt-colab-drafts-v1', 'space', 'device', 'page'],
      new TextEncoder().encode(JSON.stringify({ v: 1, drafts: entries })),
    ),
  );
  expect(await store().load('page')).toEqual(new Map());
});

it('keeps existing composer drafts readable when a block draft is saved', async () => {
  const { blockDraftStore } = await import('../src/block-drafts.js');
  const chat = edit('Keep my chat', { edited: true });
  expect(await store().apply('page', new Map([['chat', chat]]))).toBe(true);
  const draft = {
    target: 'edit-1',
    generation: 'generation-1',
    id: 'block-1',
    base: 'Plan',
    value: 'Plan Friday',
  };
  const blocks = blockDraftStore('space', 'device');
  expect(await blocks.save('page', draft)).toBe(true);
  expect(await store().load('page')).toEqual(new Map([['chat', chat]]));
  expect(await blocks.load('page')).toEqual([draft]);
});

it('keeps the newest unsaved block text after an older save is acknowledged', async () => {
  const { blockDraftStore, BlockDraftSession } = await import('../src/block-drafts.js');
  const blocks = blockDraftStore('space', 'device');
  const session = new BlockDraftSession(blocks, 'page');
  session.remember('block-1', undefined, 'Plan', 'Plan Friday');
  expect(await session.waitForStorage()).toBe(true);
  const first = session.matching('block-1', undefined, 'Plan Friday')!;
  session.remember('block-1', undefined, 'Plan', '');
  expect(await session.waitForStorage()).toBe(true);
  session.admitted(first);
  const reopened = await blocks.load('page');
  expect(reopened).toHaveLength(1);
  expect(reopened[0]).toMatchObject({ id: 'block-1', base: 'Plan', value: '' });
});

it('reopens a durable block draft until its own save is admitted', async () => {
  const { blockDraftStore, BlockDraftSession } = await import('../src/block-drafts.js');
  const session = new BlockDraftSession(blockDraftStore('space', 'device'), 'page');
  session.remember('block-1', undefined, 'Plan', 'Plan Friday');
  expect(await session.waitForStorage()).toBe(true);
  const draft = session.matching('block-1', undefined, 'Plan Friday')!;
  const reopened = blockDraftStore('space', 'device');
  expect(await reopened.load('page')).toEqual([draft]);
  session.admitted(draft);
  await expect.poll(() => reopened.load('page')).toEqual([]);
});

it('does not recover a resolved block draft when its local write was in flight', async () => {
  const { blockDraftStore, BlockDraftSession } = await import('../src/block-drafts.js');
  const store = blockDraftStore('space', 'device');
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const session = new BlockDraftSession(
    {
      ...store,
      save: async (page, draft) => {
        await held;
        return store.save(page, draft);
      },
    },
    'page',
  );
  session.remember('block-1', undefined, 'Plan', 'Plan Friday');
  const draft = session.matching('block-1', undefined, 'Plan Friday')!;
  const resolved = session.admitted(draft);
  finish();
  await resolved;
  expect(await store.load('page')).toEqual([]);
});

it('does not finish discarding a draft until its stored copy is removed', async () => {
  const { blockDraftStore, BlockDraftSession } = await import('../src/block-drafts.js');
  const store = blockDraftStore('space', 'device');
  let release!: () => void;
  let clearing!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    clearing = resolve;
  });
  const session = new BlockDraftSession(
    {
      ...store,
      clear: async (page, draft) => {
        clearing();
        await held;
        return store.clear(page, draft);
      },
    },
    'page',
  );
  session.remember('block-1', undefined, 'Plan', 'Plan Friday');
  expect(await session.waitForStorage()).toBe(true);
  let completed = false;
  const discard = session.forget('block-1', undefined).then((result) => {
    completed = true;
    return result;
  });
  await started;
  expect(completed).toBe(false);
  expect(await store.load('page')).toHaveLength(1);
  release();
  expect(await discard).toBe(true);
  expect(await store.load('page')).toEqual([]);
});

it('writes the latest block edit promptly after a rapid typing burst', async () => {
  const { BlockDraftSession } = await import('../src/block-drafts.js');
  type Draft = import('../src/block-drafts.js').BlockDraft;
  const started: Draft[] = [];
  let finishFirst!: (value: boolean) => void;
  const first = new Promise<boolean>((resolve) => {
    finishFirst = resolve;
  });
  const session = new BlockDraftSession(
    {
      load: async () => [],
      save: async (_page, draft) => {
        started.push(draft);
        return started.length === 1 ? first : true;
      },
      clear: async () => true,
    },
    'page',
  );
  for (let i = 1; i <= 20; i++) session.remember('block-1', undefined, 'Plan', `Plan ${i}`);
  const lastInput = performance.now();
  expect(started.map((draft) => draft.value)).toEqual(['Plan 1']);
  finishFirst(true);
  expect(await session.waitForStorage()).toBe(true);
  const latestDurableMs = performance.now() - lastInput;
  expect(started.map((draft) => draft.value)).toEqual(['Plan 1', 'Plan 20']);
  expect(latestDurableMs).toBeLessThan(300);
});

it('keeps the leave guard active if the block draft cannot be saved', async () => {
  const { blockDraftStore, BlockDraftSession } = await import('../src/block-drafts.js');
  unavailable = true;
  const session = new BlockDraftSession(blockDraftStore('space', 'device'), 'page');
  session.remember('block-1', undefined, 'Plan', 'Plan Friday');
  expect(await session.waitForStorage()).toBe(false);
  expect(session.unsafe()).toBe(true);
});
