import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { openSession } from '../src/device.js';
import { forms, type ProviderForm } from '../src/forms.js';
import { ClientError } from '../src/operations.js';
import { Door, paired } from './door.js';
const FORM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERSON = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const question = (): ProviderForm => ({
  formId: FORM,
  identityId: PERSON,
  openedMs: 1,
  kind: 'question',
  questions: [
    {
      text: 'Pick a synthetic option',
      choice: 'single',
      options: [{ label: 'One' }],
      freeText: false,
    },
  ],
  truncated: false,
  answerable: true,
  answerIn: 'client',
});
async function ready() {
  const door = new Door();
  const pairedDevice = await paired(door);
  const session = await openSession(
    pairedDevice.result,
    pairedDevice.key,
    door.descriptor.windowId,
    door.fetch,
  );
  return { door, client: forms(session) };
}
test('forms use the existing signing lane and freeze the original answer operation', async () => {
  const { door, client } = await ready();
  door.formsReply = (operation, input) =>
    operation === 'forms.list'
      ? { forms: [question()] }
      : operation === 'changes.cursor'
        ? { cursor: 7, usage: 3 }
        : {
            operationId: input.operationId,
            formId: input.formId,
            state: 'accepted',
            delivered: true,
          };
  assert.deepEqual(await client.list({ identityId: PERSON }), { forms: [question()] });
  assert.deepEqual(door.calls[0]!.payload, {
    version: 1,
    operation: 'forms.list',
    input: { identityId: PERSON },
  });
  assert.deepEqual(await client.cursor(), { cursor: 7, usage: 3 });
  const operationId = crypto.randomUUID(),
    input = { operationId, formId: FORM, answer: { choices: [[999]] } };
  // Core, not a second SDK option model, validates whether index999 exists.
  const pending = client.answer(input);
  input.answer.choices[0]![0] = 0;
  const first = await pending;
  assert.deepEqual(first, { operationId, formId: FORM, state: 'accepted', delivered: true });
  assert.deepEqual(door.calls[2]!.payload, {
    version: 1,
    operation: 'forms.answer',
    input: { operationId, formId: FORM, answer: { choices: [[999]] } },
  });
  assert.equal(door.calls[2]!.envelope.id, operationId);
  assert.deepEqual(await client.operation(operationId), first);
  assert.deepEqual(door.calls[3]!.payload, { operationId });
  assert.equal(door.calls.filter((c) => c.envelope.operation === 'forms.answer').length, 1);
  assert.equal(door.opens, 1);
});
test('forms retain Core unsupported and uncertain states and reject malformed signed data', async () => {
  const { door, client } = await ready();
  for (const [reason, state] of [
    ['FORM_DELIVERY_UNSUPPORTED', 'refused'],
    ['FORM_DELIVERY_UNCERTAIN', 'uncertain'],
  ] as const) {
    door.formsReply = (_operation, input) => ({
      operationId: input.operationId,
      formId: FORM,
      state,
      reason,
      message: 'Core synthetic refusal',
    });
    const operationId = crypto.randomUUID();
    const input = { operationId, formId: FORM, answer: { decision: 'allow' as const } };
    const first = await client.answer(input);
    assert.deepEqual(first, {
      operationId,
      formId: FORM,
      state,
      reason,
      message: 'Core synthetic refusal',
    });
    assert.deepEqual(await client.operation(operationId), first);
  }
  const before = door.calls.length;
  for (const answer of [
    { choices: [[0]], decision: 'allow' },
    { choices: [[1.5]] },
    { choices: [Array(9).fill(0)] },
    { choices: [[0]], other: ['x'.repeat(2049)] },
  ]) {
    assert.throws(
      () =>
        client.answer({ operationId: crypto.randomUUID(), formId: FORM, answer: answer as never }),
      TypeError,
    );
  }
  assert.equal(door.calls.length, before);
  for (const bad of [
    { cursor: -1 },
    { cursor: Number.MAX_SAFE_INTEGER + 1 },
    { cursor: 1, private: 'not allowed' },
  ]) {
    door.formsReply = () => bad;
    await assert.rejects(
      client.cursor(),
      (e: unknown) => e instanceof ClientError && e.code === 'unverifiable_response',
    );
  }
  for (const bad of [
    { ...question(), formId: 'bad' },
    { ...question(), plan: 'x'.repeat(65537) },
    { ...question(), private: 'not allowed' },
    { ...question(), openedMs: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    door.formsReply = () => ({ forms: [bad] });
    await assert.rejects(
      client.list(),
      (e: unknown) => e instanceof ClientError && e.code === 'unverifiable_response',
    );
  }
});
