import { describe, expect, it, vi } from 'vite-plus/test';
import { metadataRequest } from '@tmt/colab-client';
import { buildMetadataRequest, type MetadataOutcome } from '../src/link-metadata.js';
import {
  RecipientRefused,
  canChooseRecipient,
  chooseRecipient,
  currentRecipient,
  recipientAgents,
  recipientBody,
  recipientRequest,
} from '../src/question-recipient.js';
import type { RegisteredQuestion } from '../src/question-registry.js';
import { text } from '../src/strings.js';

const attribution = { writerId: '00000000-0000-4000-8000-000000000004', timeMs: 1 };
const reviewer = { id: '30000000-0000-4000-8000-000000000001', name: 'reviewer' };
const builder = '30000000-0000-4000-8000-000000000002';
const entry: RegisteredQuestion = {
  id: '10000000-0000-4000-8000-000000000055',
  title: 'A question',
  state: 'open',
  attribution,
};
const assigned: RegisteredQuestion = { ...entry, agent: reviewer };
const outcome = (state: Record<string, unknown>) =>
  ({ operationId: '60000000-0000-4000-8000-000000000001', ...state }) as MetadataOutcome;

describe('the recipient of a question', () => {
  it('lists each identity of the directory once, and reads the current one from the entry', () => {
    expect(
      recipientAgents([
        { agent: reviewer.id, agentName: 'reviewer' },
        { agent: builder, agentName: 'builder' },
        { agent: reviewer.id, agentName: 'reviewer (another machine)' },
      ]),
    ).toEqual([
      { id: reviewer.id, name: 'reviewer' },
      { id: builder, name: 'builder' },
    ]);
    expect(currentRecipient(entry)).toBeNull();
    expect(currentRecipient(assigned)).toBe(reviewer.id);
  });

  it('sends the identity it picked and never a label, and none to follow the creator', () => {
    expect(recipientBody(entry, builder)).toEqual({ id: entry.id, selector: builder });
    expect(recipientBody(assigned, null)).toEqual({ id: entry.id });
    expect(JSON.stringify(recipientBody(entry, builder))).not.toContain('name');
  });

  it('builds a closed editor request that carries the observed entry as its target', () => {
    for (const choice of [builder, null]) {
      const request = buildMetadataRequest(recipientRequest(assigned, choice));
      expect(metadataRequest.metadataRequest(request, 'intents', request.operationId)).toEqual(
        request,
      );
      expect(request.action).toBe('question.agent');
      expect(request.target).toEqual(assigned);
    }
    // The target is the entry as observed, not the entry as it changes later.
    const live = structuredClone(assigned);
    const input = recipientRequest(live, builder);
    live.state = 'handled';
    expect(input.target.state).toBe('open');
    // The closed grammar refuses a label, a registration field and a padded or empty selector.
    for (const body of [
      { id: entry.id, agent: reviewer },
      { id: entry.id, selector: builder, title: 'New' },
      { id: entry.id, selector: ' ' + builder },
      { id: entry.id, selector: '' },
    ])
      expect(() =>
        buildMetadataRequest({ ...recipientRequest(entry, builder), body } as never),
      ).toThrow();
  });
});

describe('choosing a recipient', () => {
  it('changes nothing when the choice is already the recipient', async () => {
    const owner = vi.fn();
    await chooseRecipient(assigned, reviewer.id, { owner });
    await chooseRecipient(entry, null, { owner });
    expect(owner).not.toHaveBeenCalled();
  });

  it('sends the owner frame body through the owner seam', async () => {
    const owner = vi.fn(async () => {});
    await chooseRecipient(entry, builder, { owner });
    await chooseRecipient(assigned, null, { owner });
    expect(owner.mock.calls).toEqual([[{ id: entry.id, selector: builder }], [{ id: entry.id }]]);
  });

  it('reads a refused owner frame as a refusal with its code and says nothing was changed', async () => {
    const refused = Object.assign(new Error('That identity was not found.'), {
      code: 'COLAB_IDENTITY_UNKNOWN',
    });
    const error = await chooseRecipient(entry, builder, {
      owner: async () => {
        throw refused;
      },
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(RecipientRefused);
    expect(error).toMatchObject({
      message: 'That identity was not found.',
      code: 'COLAB_IDENTITY_UNKNOWN',
      unconfirmed: false,
    });
  });

  it('sends an editor request through the link seam and reads the owner receipt', async () => {
    const link = vi.fn(async () => outcome({ state: 'applied', revision: 'v1:' + 'a'.repeat(64) }));
    await chooseRecipient(entry, builder, { link });
    expect(link).toHaveBeenCalledWith(recipientRequest(entry, builder));
    const settle = (state: Record<string, unknown>) =>
      chooseRecipient(entry, builder, { link: async () => outcome(state) }).catch(
        (failure: unknown) => failure as RecipientRefused,
      );
    expect(
      await settle({ state: 'refused', code: 'COLAB_STALE_BASE', message: 'The page moved.' }),
    ).toMatchObject({ message: 'The page moved.', code: 'COLAB_STALE_BASE', unconfirmed: false });
    expect(await settle({ state: 'unconfirmed' })).toMatchObject({
      message: text.metadata.requestUnconfirmed,
      unconfirmed: true,
    });
    expect(await settle({ state: 'not-sent' })).toMatchObject({
      message: text.metadata.notSent,
      unconfirmed: false,
    });
    expect(await settle({ state: 'ended' })).toMatchObject({ message: text.readerEnded });
    // A send that throws before any request existed reads as a request that could not be prepared.
    const thrown = await chooseRecipient(entry, builder, {
      link: async () => {
        throw new Error('boom');
      },
    }).catch((failure: unknown) => failure);
    expect(thrown).toMatchObject({ message: text.metadata.requestInvalid });
    // A link that sends nothing (blocked, in flight) is not a change.
    expect(
      await chooseRecipient(entry, builder, { link: async () => undefined }).catch(
        (failure: unknown) => failure,
      ),
    ).toMatchObject({ message: text.metadata.requestInvalid });
  });

  it('has no seam for a reader or a commenter', async () => {
    expect(canChooseRecipient({})).toBe(false);
    expect(canChooseRecipient({ owner: async () => {} })).toBe(true);
    expect(canChooseRecipient({ link: async () => undefined })).toBe(true);
    await expect(chooseRecipient(entry, builder, {})).rejects.toMatchObject({
      message: text.metadata.recipientOwnerOnly,
    });
  });
});
