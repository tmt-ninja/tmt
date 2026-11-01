import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import { openSession } from '../src/device.js';
import {
  conversations,
  parseConversation,
  CONVERSATION_RESPONSE_BYTES,
  type ConversationPage,
} from '../src/conversations.js';
import { operations, ClientError } from '../src/operations.js';
import { Door, paired } from './door.js';
const MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VIEWER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function page(): ConversationPage {
  return {
    viewerId: VIEWER,
    member: 'active',
    changePosition: 'opaque_Z',
    nextBefore: null,
    items: [
      {
        requestId: 'req_cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        recipientId: MEMBER,
        sender: { kind: 'verified', identityId: VIEWER },
        kind: 'request',
        origin: 'person',
        preparedAtMs: 123,
        delivery: 'sent',
        messageState: {
          state: 'answered',
          reason: { code: 'answered_by_reply', text: 'Answered' },
          latestMs: 124,
          remainingMs: null,
          canSendNow: false,
        },
        final: { status: 'retained', submittedAtMs: 124, bodyBytes: 6, expiresAtMs: 999 },
        preview: 'Question',
        responsePreview: 'Answer',
        previewTruncated: false,
        direction: 'toMember',
        changePosition: 'opaque_A',
        responseId: 'rsp_1',
      },
    ],
  };
}
async function ready() {
  const door = new Door();
  const device = await paired(door);
  const session = await openSession(
    device.result,
    device.key,
    door.descriptor.windowId,
    door.fetch,
  );
  door.conversationReply = () => page();
  return { door, session, client: conversations(session) };
}
test('conversation read freezes the exact scoped input and shares the existing signing lane', async () => {
  const { door, session, client } = await ready();
  const before = { preparedAtMs: 12, requestId: 'req_dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  const input = { before, since: 'old_Position', limit: 50 };
  door.conversationReply = () => ({ ...page(), changedSince: { count: 1, more: false } });
  const pending = client.read(MEMBER, input);
  before.preparedAtMs = 99;
  input.since = 'changed';
  const [answer] = await Promise.all([pending, operations(session).listAgents()]);
  assert.equal(answer.viewerId, VIEWER);
  assert.equal(answer.changePosition, 'opaque_Z');
  assert.equal(client.machineId, door.descriptor.machineId);
  assert.deepEqual(door.calls[0]!.payload, {
    version: 1,
    operation: 'requests.list',
    input: {
      memberId: MEMBER,
      limit: 50,
      before: { preparedAtMs: 12, requestId: before.requestId },
      since: 'old_Position',
    },
  });
  assert.deepEqual(
    door.calls.map((call) => call.envelope.sequence),
    ['1', '2'],
  );
  assert.equal(door.opens, 1);
  assert.deepEqual(
    door.calls.map((call) => call.envelope.operation),
    ['requests.list', 'agents.list'],
  );
});
test('conversation input rejects viewer selection, malformed positions and bounds before HTTP', async () => {
  const { door, client, session } = await ready();
  assert.throws(() => conversations({ ...session }), TypeError);
  for (const input of [
    { viewerId: VIEWER },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { since: '' },
    { since: 'a.b' },
    { since: 'x'.repeat(65) },
    { before: null },
    { before: { preparedAtMs: 0, requestId: MEMBER } },
  ]) {
    assert.throws(() => client.read(MEMBER, input as never), TypeError);
  }
  assert.throws(() => client.read('display name'), TypeError);
  assert.equal(door.calls.length, 0);
});
test('signed malformed, cross-person, oversized and secret-bearing replies are unverifiable', async () => {
  for (const change of [
    (value: ConversationPage) => {
      value.items[0]!.sender.identityId = MEMBER;
    },
    (value: ConversationPage) => {
      value.items[0]!.responsePreview = 'x'.repeat(161);
    },
    (value: ConversationPage) => {
      (value as unknown as Record<string, unknown>).receipt = 'private';
    },
    (value: ConversationPage) => {
      value.changePosition = 'x'.repeat(65);
    },
    (value: ConversationPage) => {
      (value.items[0]!.final as unknown as Record<string, unknown>).response = 'full final';
    },
    (value: ConversationPage) => {
      value.items = Array.from({ length: 21 }, () => ({ ...value.items[0]! }));
    },
  ]) {
    const { door, client } = await ready();
    door.conversationReply = () => {
      const value = page();
      change(value);
      return value;
    };
    await assert.rejects(
      client.read(MEMBER),
      (error: unknown) => error instanceof ClientError && error.code === 'unverifiable_response',
    );
  }
});
test('Core final states, unknown members and changedSince stay exact without inferred zero', () => {
  const value = page();
  value.items[0]!.final = { status: 'expired', submittedAtMs: 1, expiresAtMs: 2 };
  value.items[0]!.responsePreview = null;
  value.items[0]!.previewTruncated = false;
  assert.equal(parseConversation(value, MEMBER, {}).items[0]!.final.status, 'expired');
  for (const changedSince of [
    'unknown',
    { count: 50, more: true },
    { count: 0, more: false },
  ] as const) {
    const raw = { ...page(), items: [], member: 'retired', changedSince };
    assert.deepEqual(parseConversation(raw, MEMBER, { since: 'old' }).changedSince, changedSince);
  }
  assert.throws(() =>
    parseConversation({ ...page(), changedSince: { count: 1, more: true } }, MEMBER, {
      since: 'old',
    }),
  );
  assert.throws(() => parseConversation({ ...page(), changedSince: 'unknown' }, MEMBER, {}));
});

const capVector = JSON.parse(
  readFileSync(
    new URL('../../../rust/tmt-remote/tests/fixtures/conversation-bounds.json', import.meta.url),
    'utf8',
  ),
) as { responseBytes: number };
function maximumPage(withdrawn: boolean, escaped: boolean): ConversationPage {
  const value = page();
  const text = (bytes: number) => (escaped ? '\u0000'.repeat(bytes) : '🦊'.repeat(bytes / 4));
  const item = value.items[0]!;
  item.preparedAtMs = Number.MAX_SAFE_INTEGER;
  item.origin = 'automation';
  item.delivery = 'definitely_failed';
  item.changePosition = 'x'.repeat(64);
  item.responseId = 'r'.repeat(128);
  item.preview = escaped ? '\u0000'.repeat(160) : text(640);
  item.messageState!.reason = { code: 'r'.repeat(64), text: text(256) };
  item.messageState!.latestMs = Number.MAX_SAFE_INTEGER;
  item.messageState!.remainingMs = Number.MAX_SAFE_INTEGER;
  item.final = withdrawn
    ? { status: 'withdrawn', reason: text(1024), withdrawnAtMs: Number.MAX_SAFE_INTEGER }
    : {
        status: 'retained',
        submittedAtMs: Number.MAX_SAFE_INTEGER,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
        bodyBytes: Number.MAX_SAFE_INTEGER,
      };
  item.responsePreview = withdrawn ? null : item.preview;
  item.previewTruncated = !withdrawn;
  value.items = Array.from({ length: 50 }, (_, index) => ({
    ...structuredClone(item),
    requestId: `req_00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  }));
  value.changePosition = 'p'.repeat(64);
  value.nextBefore = {
    preparedAtMs: Number.MAX_SAFE_INTEGER,
    requestId: value.items[49]!.requestId,
  };
  value.changedSince = { count: 50, more: true };
  return value;
}
test('full maximum conversation pages fit the response policy including JSON escaping', async () => {
  assert.equal(CONVERSATION_RESPONSE_BYTES, capVector.responseBytes);
  const { door, client } = await ready();
  // Four-byte scalars and control escapes exercise UTF-8 and JSON expansion.
  for (const withdrawn of [false, true])
    for (const escaped of [false, true]) {
      const raw = maximumPage(withdrawn, escaped);
      assert.ok(new TextEncoder().encode(JSON.stringify(raw)).length > 65536);
      assert.equal(
        parseConversation(raw, MEMBER, { limit: 50, since: 'baseline' }).items.length,
        50,
      );
      door.conversationReply = () => raw;
      assert.equal((await client.read(MEMBER, { limit: 50, since: 'baseline' })).items.length, 50);
    }
});
test('a conversation response one byte over the policy is refused before field projection', async () => {
  const raw = { ...maximumPage(true, true), unknownPadding: '' };
  raw.unknownPadding = 'x'.repeat(
    capVector.responseBytes + 1 - new TextEncoder().encode(JSON.stringify(raw)).length,
  );
  assert.equal(new TextEncoder().encode(JSON.stringify(raw)).length, capVector.responseBytes + 1);
  assert.throws(
    () => parseConversation(raw, MEMBER, { limit: 50, since: 'baseline' }),
    /Conversation response exceeds byte limit/,
  );
  const { door, client } = await ready();
  door.conversationReply = () => raw;
  await assert.rejects(
    client.read(MEMBER, { limit: 50, since: 'baseline' }),
    (error: unknown) => error instanceof ClientError && error.code === 'unverifiable_response',
  );
});
