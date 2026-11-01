/** Owner-browser DM history through one verified Session; no opener, writes or Core ack. */
import type { Session } from './device.js';
import { channelFor } from './session-channel.js';
import {
  coreId,
  requestId,
  messageState,
  verifiedSessionRequest,
  type MessageState,
} from './operations.js';

export interface ConversationCursor {
  preparedAtMs: number;
  requestId: string;
}
export interface ConversationInput {
  limit?: number;
  before?: ConversationCursor;
  since?: string;
}
export type ConversationFinal =
  | { status: 'not_submitted' | 'not_required' }
  | { status: 'withdrawn'; reason: string; withdrawnAtMs: number }
  | { status: 'retained'; submittedAtMs: number; expiresAtMs: number; bodyBytes: number }
  | { status: 'expired' | 'unavailable'; submittedAtMs: number; expiresAtMs: number };
export interface ConversationItem {
  requestId: string;
  recipientId: string;
  sender: { kind: 'explicit' | 'verified'; identityId: string };
  kind: 'request' | 'announcement';
  origin: 'person' | 'automation' | 'unknown';
  preparedAtMs: number;
  delivery: 'prepared' | 'sending' | 'sent' | 'queued' | 'uncertain' | 'definitely_failed';
  messageState?: MessageState;
  final: ConversationFinal;
  preview: string | null;
  responsePreview: string | null;
  previewTruncated: boolean;
  direction: 'toMember' | 'fromMember';
  changePosition: string;
  responseId?: string;
}
export type ConversationChanges = { count: number; more: boolean } | 'unknown';
export interface ConversationPage {
  viewerId: string;
  member: 'active' | 'unknown' | 'retired';
  items: ConversationItem[];
  nextBefore: ConversationCursor | null;
  changePosition: string;
  changedSince?: ConversationChanges;
}
export interface RemoteConversations {
  readonly machineId: string;
  read(memberId: string, input?: ConversationInput): Promise<ConversationPage>;
}
const utf8 = new TextEncoder();
export const conversationPosition = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
function valid(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid conversation response.');
}
function object(value: unknown): Record<string, unknown> {
  valid(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, required: string[], optional: string[] = []): void {
  valid(
    required.every((key) => Object.hasOwn(row, key)) &&
      Object.keys(row).every((key) => required.includes(key) || optional.includes(key)),
  );
}
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const preview = (value: unknown) =>
  value === null ||
  (typeof value === 'string' && [...value].length <= 160 && utf8.encode(value).length <= 640);
function cursor(value: unknown): ConversationCursor {
  const row = object(value);
  keys(row, ['preparedAtMs', 'requestId']);
  valid(integer(row.preparedAtMs) && requestId(row.requestId));
  return { preparedAtMs: row.preparedAtMs, requestId: row.requestId };
}
function final(value: unknown): ConversationFinal {
  const row = object(value);
  switch (row.status) {
    case 'not_submitted':
    case 'not_required':
      keys(row, ['status']);
      break;
    case 'withdrawn':
      keys(row, ['status', 'reason', 'withdrawnAtMs']);
      valid(
        typeof row.reason === 'string' &&
          utf8.encode(row.reason).length <= 1024 &&
          integer(row.withdrawnAtMs),
      );
      break;
    case 'retained':
      keys(row, ['status', 'submittedAtMs', 'expiresAtMs', 'bodyBytes']);
      valid(integer(row.submittedAtMs) && integer(row.expiresAtMs) && integer(row.bodyBytes));
      break;
    case 'expired':
    case 'unavailable':
      keys(row, ['status', 'submittedAtMs', 'expiresAtMs']);
      valid(integer(row.submittedAtMs) && integer(row.expiresAtMs));
      break;
    default:
      throw new Error('Invalid conversation final.');
  }
  return { ...row } as ConversationFinal;
}
/** Called only after signature/correlation verification by the shared Session lane. */
export function parseConversation(
  value: unknown,
  memberId: string,
  input: ConversationInput,
): ConversationPage {
  valid(utf8.encode(JSON.stringify(value)).length <= 65536);
  const row = object(value);
  keys(
    row,
    ['viewerId', 'member', 'items', 'nextBefore', 'changePosition'],
    input.since === undefined ? [] : ['changedSince'],
  );
  valid(
    coreId(row.viewerId) &&
      ['active', 'unknown', 'retired'].includes(row.member as string) &&
      conversationPosition(row.changePosition) &&
      Array.isArray(row.items) &&
      row.items.length <= (input.limit ?? 20),
  );
  valid(row.member === 'active' || row.items.length === 0);
  const ids = new Set<string>();
  const items = row.items.map((value): ConversationItem => {
    const item = object(value);
    keys(
      item,
      [
        'requestId',
        'recipientId',
        'sender',
        'kind',
        'origin',
        'preparedAtMs',
        'delivery',
        'messageState',
        'final',
        'preview',
        'responsePreview',
        'previewTruncated',
        'direction',
        'changePosition',
      ],
      ['responseId'],
    );
    const sender = object(item.sender);
    keys(sender, ['kind', 'identityId']);
    valid(
      requestId(item.requestId) &&
        !ids.has(item.requestId) &&
        coreId(item.recipientId) &&
        coreId(sender.identityId) &&
        ['explicit', 'verified'].includes(sender.kind as string) &&
        ['request', 'announcement'].includes(item.kind as string) &&
        ['person', 'automation', 'unknown'].includes(item.origin as string) &&
        ['prepared', 'sending', 'sent', 'queued', 'uncertain', 'definitely_failed'].includes(
          item.delivery as string,
        ) &&
        integer(item.preparedAtMs) &&
        preview(item.preview) &&
        preview(item.responsePreview) &&
        typeof item.previewTruncated === 'boolean' &&
        conversationPosition(item.changePosition),
    );
    ids.add(item.requestId);
    valid(
      item.direction === 'toMember'
        ? item.recipientId === memberId && sender.identityId === row.viewerId
        : item.direction === 'fromMember' &&
            item.recipientId === row.viewerId &&
            sender.identityId === memberId,
    );
    const settled = final(item.final);
    valid(
      settled.status === 'retained' ||
        (item.responsePreview === null && item.previewTruncated === false),
    );
    if (item.responseId !== undefined)
      valid(typeof item.responseId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.responseId));
    const { messageState: state } = messageState(item);
    const { messageState: _rawState, ...rest } = item;
    return {
      ...rest,
      sender: { ...sender },
      final: settled,
      ...(state ? { messageState: state } : {}),
    } as unknown as ConversationItem;
  });
  let changedSince: ConversationChanges | undefined;
  if (input.since !== undefined) {
    valid(Object.hasOwn(row, 'changedSince'));
    if (row.changedSince === 'unknown') changedSince = 'unknown';
    else {
      const changes = object(row.changedSince);
      keys(changes, ['count', 'more']);
      valid(
        integer(changes.count) &&
          changes.count <= 50 &&
          typeof changes.more === 'boolean' &&
          (!changes.more || changes.count === 50),
      );
      changedSince = { count: changes.count, more: changes.more };
    }
  }
  return {
    viewerId: row.viewerId,
    member: row.member as ConversationPage['member'],
    items,
    nextBefore: row.nextBefore === null ? null : cursor(row.nextBefore),
    changePosition: row.changePosition,
    ...(changedSince === undefined ? {} : { changedSince }),
  };
}
export function conversations(
  session: Session,
  options: { timeoutMs?: number } = {},
): RemoteConversations {
  const channel = channelFor(session);
  if (!channel) throw new TypeError('Use a verified Session.');
  const call = verifiedSessionRequest(session, options);
  return {
    machineId: channel.paired.machineId,
    read(memberId, value = {}) {
      if (
        !coreId(memberId) ||
        Object.keys(value).some((key) => !['limit', 'before', 'since'].includes(key)) ||
        (value.limit !== undefined &&
          (!integer(value.limit) || value.limit < 1 || value.limit > 50)) ||
        (value.since !== undefined && !conversationPosition(value.since))
      )
        throw new TypeError('Invalid conversation input.');
      let before: ConversationCursor | undefined;
      if (value.before !== undefined) {
        try {
          before = cursor(value.before);
        } catch {
          throw new TypeError('Invalid conversation cursor.');
        }
      }
      const frozen: ConversationInput = {
        limit: value.limit ?? 20,
        ...(before ? { before } : {}),
        ...(value.since === undefined ? {} : { since: value.since }),
      };
      return call(
        'requests.list',
        crypto.randomUUID(),
        { version: 1, operation: 'requests.list', input: { memberId, ...frozen } },
        (answer) => parseConversation(answer, memberId, frozen),
      );
    },
  };
}
