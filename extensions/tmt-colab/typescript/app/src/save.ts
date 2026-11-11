import { attachment, exactKeys, requireValue, text as bytes } from '@tmt/colab-client';
import { SOURCE_BYTES } from './fold-protocol.js';
import { OwnAppendRefused } from './own-publication.js';
import { SAVE_HUNKS, type SaveHunk } from './save-hunks.js';
import { text } from './strings.js';

/** The most one page source can hold; mirrors decoder.rs `BASELINE_BYTES`. */
export const SAVE_SOURCE_BYTES = SOURCE_BYTES;

export type SaveState = 'committed' | 'unchanged' | 'absent' | 'pending' | 'running' | 'rejected';
/** The one reply to a save or a status request (`saveresult`). */
export interface QuestionWriteFinding {
  code: string;
  line: number;
  fix: string;
}
/** Stable relationship-admission reasons; absent on replies from older owners. */
const LINK_REFUSAL_REASONS = [
  'second-parent',
  'cycle',
  'invalid-hierarchy',
  'unavailable',
] as const;
export type LinkRefusalReason = (typeof LINK_REFUSAL_REASONS)[number];
export interface SaveResult {
  findings?: QuestionWriteFinding[];
  operationId: string;
  state: SaveState;
  revision?: string;
  /** Committed only: the page had changed since the editor opened it and the edit was merged. */
  merged?: true;
  /** Merged only: the digest of the source the commit holds, which the editor never had. */
  sourceSha256?: string;
  code?: string;
  message?: string;
  reason?: LinkRefusalReason;
  /** Rejected as `COLAB_PATCH_CONFLICT` only: the hunks, as sent (0-based), that do not fit. */
  conflicts?: number[];
  /** A `subpage.create` only: the page the operation made, whatever became of its attach. */
  childPage?: string;
}

/** The one reply to a `work` frame: a save's fields. */
export type WorkResult = SaveResult;
export const SUBPAGE_BATCH_ENTRIES = 128;
export interface SubpageBatchEntry {
  operationId: string;
  state: 'committed' | 'unchanged';
  childPage: string;
}
export interface SubpageBatchResult extends SaveResult {
  state: 'running' | 'committed' | 'rejected' | 'absent';
  entries: SubpageBatchEntry[];
  nextIndex: number;
}
/** A block batch's reply (contract: Blocks): the save outcome plus, once the batch reached the
 * page, its receipt: the ops it applied, the typed hunks a whole-text op could not apply, and the
 * attachment IDs a batch with an attachment change listed and removed (#6190). */
export interface BlocksResult extends SaveResult {
  receipt?: {
    ops: { op: string; id: string }[];
    droppedHunks: { id: string; from: number; to: number; text: string }[];
    attachments?: { set: string[]; remove: string[] };
  };
}
/** The most ops one block batch carries (`limits::BLOCK_BATCH_OPS`). */
export const BLOCK_BATCH_OPS = 256;
/** A block batch refused as stale is sent again this many more times (`limits::SAVE_EVALUATIONS`). */
export const BLOCK_STALE_RETRIES = 3;
/**
 * `send` again, as a new operation, after the serve refused it as `COLAB_STALE_BASE`: the page
 * moved between the serve's preparation and its commit, so nothing was written, and the batch
 * (which carries no revision and names blocks by ID) is prepared on the page as it is now. Only
 * that refusal is sent again; an outcome in doubt, a timeout and every other refusal reach the
 * caller as they are, and so does the last stale refusal (#6220).
 */
export async function resendStale<T>(send: () => Promise<T>): Promise<T> {
  for (let resent = 0; ; resent++) {
    try {
      return await send();
    } catch (error) {
      if (
        !(error instanceof SaveRefused) ||
        error.code !== 'COLAB_STALE_BASE' ||
        resent >= BLOCK_STALE_RETRIES
      )
        throw error;
    }
  }
}
/** The codes of a refusal that sending the batch again can get past: the page moved on
 * (`COLAB_STALE_BASE`), this device's stream did (`COLAB_STREAM_GAP`), or the serve could not take
 * the batch (`COLAB_UNAVAILABLE`, which is also the code of a refusal that carries none). Any other
 * code names a batch that is refused the same way each time. */
const REFUSED_FOR_NOW = new Set(['COLAB_STALE_BASE', 'COLAB_STREAM_GAP', 'COLAB_UNAVAILABLE']);
/** Whether the page may offer to send a refused batch again (#6227). */
export function canSendAgain(error: SaveRefused): boolean {
  return REFUSED_FOR_NOW.has(error.code);
}
/** The closed work actions a browser sends (contract: Work); the serve refuses any other. */
export type WorkAction =
  | 'summary.set'
  | 'summary.clear'
  | 'subpage.attach'
  | 'subpage.detach'
  | 'subpage.move'
  /** Makes a page from a title, then attaches it; the one action that makes a page. */
  | 'subpage.create';

/** Closed metadata actions; the native owner checks the expected revision and body. */
export type MetadataAction =
  | 'creator.set'
  | 'question.handle'
  | 'question.reopen'
  | 'question.agent'
  | 'page.state'
  | 'page.convert'
  | 'page.revert';

/** The source is over the page limit; nothing was sent. */
export class SaveTooLarge extends Error {
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super('Source exceeds the page limit');
  }
}
/** The edit is over what a link can send as an edit request; nothing was sent. */
export class EditTooLarge extends SaveTooLarge {}
/** Native preparation or commit refused the save; nothing changed. */
export class SaveRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly conflicts?: number[],
    /** A create refused after its page was made: the page exists and is not attached. */
    readonly childPage?: string,
    readonly findings?: QuestionWriteFinding[],
    readonly reason?: LinkRefusalReason,
  ) {
    super(findings?.length ? `${message} Fix: ${findings[0].fix}` : message);
  }
}
/** The page changed elsewhere where the edit is anchored, so nothing was saved and the draft is
 * kept. `first` names the first hunk that does not fit, in the source the editor opened. */
export class SaveConflict extends Error {
  constructor(
    readonly count: number,
    readonly first: { line: number; excerpt: string },
  ) {
    super('The edit conflicts with a change made elsewhere');
  }
}
/** The operation never reached commit: nothing changed, and a new save is a new operation. */
export class SaveNotApplied extends Error {
  constructor(
    readonly operationId: string,
    /** A convert whose page was made but whose link never landed. */
    readonly childPage?: string,
  ) {
    super('Save did not reach the page');
  }
}
/** The reply was lost and one status check could not settle it. Never resent automatically. */
export class SaveOutcomeUnknown extends Error {
  constructor(readonly operationId: string) {
    super('Save outcome unknown');
  }
}

const STATES: readonly string[] = ['committed', 'unchanged', 'absent', 'pending', 'rejected'];
export function saveResult(frame: Record<string, unknown>, operationId: string): SaveResult {
  const state = frame.state;
  requireValue(typeof state === 'string' && STATES.includes(state));
  exactKeys(frame, [
    'version',
    'type',
    'space',
    'page',
    'epoch',
    'operationId',
    'state',
    ...(state === 'committed' || state === 'unchanged' ? ['revision'] : []),
    ...(state === 'committed' && Object.hasOwn(frame, 'merged') ? ['merged', 'sourceSha256'] : []),
    ...(state === 'rejected' ? ['code'] : []),
    ...(state === 'rejected' && Object.hasOwn(frame, 'message') ? ['message'] : []),
    ...(state === 'rejected' && Object.hasOwn(frame, 'reason') ? ['reason'] : []),
    ...(state === 'rejected' && Object.hasOwn(frame, 'conflicts') ? ['conflicts'] : []),
    ...(state === 'rejected' && Object.hasOwn(frame, 'findings') ? ['findings'] : []),
    ...(Object.hasOwn(frame, 'childPage') ? ['childPage'] : []),
  ]);
  requireValue(frame.operationId === operationId);
  if (state === 'committed' || state === 'unchanged')
    // The revision is opaque (`v1:<hash>`): compared for equality, never parsed.
    requireValue(typeof frame.revision === 'string' && /^[\x21-\x7e]{1,128}$/.test(frame.revision));
  if (state === 'rejected')
    requireValue(
      typeof frame.code === 'string' &&
        /^[A-Z_]{1,64}$/.test(frame.code) &&
        (frame.message === undefined ||
          (typeof frame.message === 'string' && frame.message.length <= 512)),
    );
  requireValue(
    frame.reason === undefined ||
      (frame.code === 'COLAB_LINK_REFUSED' &&
        typeof frame.reason === 'string' &&
        LINK_REFUSAL_REASONS.some((reason) => reason === frame.reason)),
  );
  // A made page is named only where a create's outcome is final: committed, absent or rejected.
  requireValue(
    frame.childPage === undefined ||
      (typeof frame.childPage === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          frame.childPage,
        ) &&
        (state === 'committed' || state === 'absent' || state === 'rejected')),
  );
  requireValue(frame.merged === undefined || frame.merged === true);
  if (frame.merged === true)
    requireValue(
      typeof frame.sourceSha256 === 'string' && /^[A-Za-z0-9_-]{43}$/.test(frame.sourceSha256),
    );
  const findings = frame.findings;
  if (findings !== undefined) {
    requireValue(Array.isArray(findings) && findings.length >= 1 && findings.length <= 50);
    for (const finding of findings) {
      exactKeys(finding, ['code', 'line', 'fix']);
      requireValue(
        [
          'COLAB_QUESTION_UNREGISTERED',
          'COLAB_QUESTION_AGENT_MISMATCH',
          'COLAB_QUESTION_AGENT_UNKNOWN',
        ].includes(finding.code as string) &&
          Number.isSafeInteger(finding.line) &&
          (finding.line as number) >= 1 &&
          (finding.line as number) <= SOURCE_BYTES + 1 &&
          typeof finding.fix === 'string' &&
          bytes(finding.fix).length > 0 &&
          bytes(finding.fix).length <= 2048 &&
          !/[\p{Cc}]/u.test(finding.fix),
      );
    }
    requireValue(frame.code === findings[0].code);
  }
  const conflicts = frame.conflicts;
  if (conflicts !== undefined)
    // The hunks that do not fit, ascending and distinct, only for a patch conflict.
    requireValue(
      frame.code === 'COLAB_PATCH_CONFLICT' &&
        Array.isArray(conflicts) &&
        conflicts.length >= 1 &&
        conflicts.length <= SAVE_HUNKS &&
        conflicts.every(
          (at, i) =>
            Number.isSafeInteger(at) &&
            at >= 0 &&
            at < SAVE_HUNKS &&
            (i === 0 || at > conflicts[i - 1]),
        ),
    );
  return {
    operationId,
    state: state as SaveState,
    ...(typeof frame.revision === 'string' ? { revision: frame.revision } : {}),
    ...(frame.merged === true
      ? { merged: true as const, sourceSha256: frame.sourceSha256 as string }
      : {}),
    ...(typeof frame.code === 'string' ? { code: frame.code } : {}),
    ...(typeof frame.message === 'string' ? { message: frame.message } : {}),
    ...(typeof frame.reason === 'string' ? { reason: frame.reason as LinkRefusalReason } : {}),
    ...(Array.isArray(conflicts) ? { conflicts: conflicts as number[] } : {}),
    ...(Array.isArray(findings) ? { findings: findings as unknown as QuestionWriteFinding[] } : {}),
    ...(typeof frame.childPage === 'string' ? { childPage: frame.childPage } : {}),
  };
}
export function workResult(frame: Record<string, unknown>, operationId: string): WorkResult {
  return saveResult(frame, operationId);
}

/** The ordered, bounded receipt of an owner sub-page create batch or its status. */
export function subpageBatchResult(
  frame: Record<string, unknown>,
  operationId: string,
): SubpageBatchResult {
  const state = frame.state;
  requireValue(
    state === 'running' || state === 'committed' || state === 'rejected' || state === 'absent',
  );
  const { entries, nextIndex, ...base } = frame;
  if (state === 'absent') {
    requireValue(entries === undefined && nextIndex === undefined);
    const result = saveResult(base, operationId);
    requireValue(result.childPage === undefined);
    return { ...result, state, entries: [], nextIndex: 0 };
  }
  requireValue(Array.isArray(entries) && entries.length <= SUBPAGE_BATCH_ENTRIES);
  requireValue(Number.isSafeInteger(nextIndex) && nextIndex === entries.length);
  requireValue(state !== 'committed' || entries.length > 0);
  const ids = new Set<string>();
  const pages = new Set<string>();
  const generatedId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const entry of entries) {
    exactKeys(entry, ['operationId', 'state', 'childPage']);
    requireValue(typeof entry.operationId === 'string' && generatedId.test(entry.operationId));
    requireValue(typeof entry.childPage === 'string' && generatedId.test(entry.childPage));
    requireValue(entry.state === 'committed' || entry.state === 'unchanged');
    requireValue(!ids.has(entry.operationId) && !pages.has(entry.childPage));
    ids.add(entry.operationId);
    pages.add(entry.childPage);
  }
  const result = saveResult(
    state === 'running' ? { ...base, state: 'pending' } : base,
    operationId,
  );
  return {
    ...result,
    state,
    entries: entries as SubpageBatchEntry[],
    nextIndex: nextIndex as number,
  };
}
export function blocksResult(frame: Record<string, unknown>, operationId: string): BlocksResult {
  const { receipt, ...rest } = frame;
  const result = saveResult(rest, operationId);
  if (receipt === undefined) return result;
  exactKeys(receipt, [
    'ops',
    'droppedHunks',
    ...(Object.hasOwn(receipt as object, 'attachments') ? ['attachments'] : []),
  ]);
  const { ops, droppedHunks, attachments } = receipt as Record<string, unknown>;
  if (attachments !== undefined) {
    exactKeys(attachments, ['set', 'remove']);
    for (const ids of Object.values(attachments as Record<string, unknown>))
      requireValue(
        Array.isArray(ids) &&
          ids.length <= attachment.DOCUMENT_ATTACHMENTS &&
          ids.every((id) => typeof id === 'string' && /^[\x21-\x7e]{1,128}$/.test(id)),
      );
  }
  requireValue(Array.isArray(ops) && ops.length <= BLOCK_BATCH_OPS);
  requireValue(Array.isArray(droppedHunks) && droppedHunks.length <= BLOCK_BATCH_OPS * SAVE_HUNKS);
  for (const op of ops) {
    exactKeys(op, ['op', 'id']);
    requireValue(typeof op.op === 'string' && typeof op.id === 'string');
  }
  for (const hunk of droppedHunks) {
    exactKeys(hunk, ['id', 'from', 'to', 'text']);
    requireValue(
      typeof hunk.id === 'string' &&
        Number.isSafeInteger(hunk.from) &&
        Number.isSafeInteger(hunk.to) &&
        (hunk.from as number) >= 0 &&
        (hunk.to as number) >= (hunk.from as number) &&
        typeof hunk.text === 'string',
    );
  }
  return {
    ...result,
    receipt: {
      ops: ops as { op: string; id: string }[],
      droppedHunks: droppedHunks as { id: string; from: number; to: number; text: string }[],
      ...(attachments !== undefined && {
        attachments: attachments as { set: string[]; remove: string[] },
      }),
    },
  };
}
/** A settled result as the outcome the caller sees: success returns, everything else throws. */
export function settled(result: SaveResult): SaveResult {
  // Still preparing on the page: the outcome is not final, and the save is never sent again.
  if (result.state === 'pending' || result.state === 'running')
    throw new SaveOutcomeUnknown(result.operationId);
  if (result.state === 'absent') throw new SaveNotApplied(result.operationId, result.childPage);
  if (result.state === 'rejected')
    throw new SaveRefused(
      result.code ?? 'COLAB_UNAVAILABLE',
      result.message ?? '',
      result.conflicts,
      result.childPage,
      result.findings,
      result.reason,
    );
  return result;
}
/** How long a lost save waits for the page to reopen, and for the saved source to show. */
export const SAVE_REOPEN_MS = 20_000;
/** `settled` for a save that sent anchored `hunks`: a refusal that names hunks which no longer fit
 * is the conflict the first of them anchors, in the source the editor opened. */
export function settledAgainst(result: SaveResult, hunks?: readonly SaveHunk[]): SaveResult {
  try {
    return settled(result);
  } catch (error) {
    const conflicts = error instanceof SaveRefused ? (error.conflicts ?? []) : [];
    const named = conflicts.filter((at) => at < (hunks?.length ?? 0));
    if (hunks && named.length > 0)
      throw new SaveConflict(named.length, conflictAt(hunks[named[0]]));
    throw error;
  }
}
/** The sentence an editor shows for a save that did not succeed. */
export function saveMessage(error: unknown): string {
  if (error instanceof OwnAppendRefused) return text.linkEditRaced;
  if (error instanceof EditTooLarge) return text.linkEditTooLarge(error.size, error.limit);
  if (error instanceof SaveTooLarge) return text.saveTooLarge(error.size, error.limit);
  if (error instanceof SaveOutcomeUnknown) return text.saveUnknown(error.operationId);
  if (error instanceof SaveNotApplied) return text.saveNotApplied;
  if (error instanceof SaveConflict)
    return error.count === 1
      ? text.saveConflict(error.first.excerpt, error.first.line)
      : text.saveConflicts(error.count, error.first.excerpt, error.first.line);
  if (error instanceof SaveRefused)
    return error.code === 'COLAB_STALE_BASE' ? text.saveStale : error.message || text.editFailed;
  return text.editFailed;
}

/** The most characters of the first changed line a conflict quotes. */
const EXCERPT_CHARACTERS = 60;
/** Control characters and the bidi marks and overrides, which a quote must not carry. */
const INERT = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
/**
 * What a conflict names: the first line of the hunk's base region that the editor changed (past
 * the context it carries) and holds text, whitespace collapsed and made inert, clipped to 60
 * characters, and its line number in the source the editor opened. The editor shows no line
 * numbers and the person's own edits shift lines, so the quote is what they search for.
 */
export function conflictAt(hunk: SaveHunk): { line: number; excerpt: string } {
  const split = (source: string) => {
    const lines = source.split('\n');
    if (lines.at(-1) === '') lines.pop();
    return lines;
  };
  const lines = split(hunk.old);
  const after = split(hunk.new);
  // The lines both sides share at the start are context; the change begins where they differ.
  let changed = 0;
  while (changed < lines.length - 1 && lines[changed] === after[changed]) changed++;
  const clean = (line: string) => line.replace(/\s+/gu, ' ').replace(INERT, '').trim();
  const named = [...lines.keys()]
    .filter((at) => at >= changed)
    .concat([...lines.keys()].filter((at) => at < changed))
    .find((at) => clean(lines[at]) !== '');
  const at = named ?? changed;
  const characters = Array.from(clean(lines[at] ?? ''));
  return {
    line: hunk.oldStart + at,
    excerpt:
      characters.length > EXCERPT_CHARACTERS
        ? `${characters.slice(0, EXCERPT_CHARACTERS).join('')}…`
        : characters.join(''),
  };
}
