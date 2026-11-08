// Attachments on a page of blocks (#6190), the browser's mirror of `blocks::attachments` in the
// native crate: the same rules over the same vectors (`block-attachments-v1.json`). The serve is
// the authority; the editor uses this to refuse a batch before it is sent. The checks are made when
// a batch is admitted, never when a state is folded, because two writers (one removes a descriptor,
// the other inserts an image that names it) must still merge into a page that folds.
import { attachment, generatedId } from '@tmt/colab-client';
import type { BlockEntry } from './blocks.js';

const REFERENCE = 'colab-attachment:';

/** Why a batch was refused: `attachment` for a reference the page does not hold (or a removal of
 * one a live block shows), `invalid` for a change the shared attachment rules refuse. */
export class AttachmentRefusal extends Error {
  constructor(readonly reason: 'attachment' | 'invalid') {
    super(reason);
  }
}

/** The live references: each `colab-attachment:` string in an image's `src` or a file's `href` on
 * a block that is not deleted. */
function live(blocks: Readonly<Record<string, BlockEntry>>): Set<string> {
  const found = new Set<string>();
  for (const block of Object.values(blocks)) {
    if (Object.hasOwn(block, 'deleted')) continue;
    const props = block.props as Record<string, unknown>;
    for (const [list, key] of [
      ['images', 'src'],
      ['files', 'href'],
    ] as const) {
      const items = props[list];
      if (!Array.isArray(items)) continue;
      for (const item of items as Record<string, unknown>[]) {
        const value = item?.[key];
        if (typeof value === 'string' && value.startsWith(REFERENCE)) found.add(value);
      }
    }
  }
  return found;
}

/** The token of a reference the renderer resolves: 8 lowercase hex digits (a unique ID prefix) or
 * a full attachment ID; `undefined` is malformed. */
function token(reference: string): string | undefined {
  const value = reference.slice(REFERENCE.length);
  if (/^[0-9a-f]{8}$/.test(value)) return value;
  try {
    generatedId(value);
    return value;
  } catch {
    return undefined;
  }
}

/** The one descriptor a token names: the full ID, or the only ID with that prefix. */
function resolve(
  value: string,
  list: readonly attachment.AttachmentDescriptor[],
): attachment.AttachmentDescriptor | undefined {
  if (value.length === 8) {
    const named = list.filter((d) => d.attachmentId.startsWith(value));
    return named.length === 1 ? named[0] : undefined;
  }
  return list.find((d) => d.attachmentId === value);
}

/** How many descriptors of `list` an 8-hex token names as a prefix. */
function holders(list: readonly attachment.AttachmentDescriptor[], value: string): number {
  return list.filter((d) => d.attachmentId.startsWith(value)).length;
}

/** Admit `rawChange` to a batch that took `before` to `next`, on a page that holds `current`.
 * Returns the list afterwards when the change alters it, `undefined` when it leaves it as it is.
 * `sourceSha256` is the lowercase hex digest of the page's `html` root. */
export function admitAttachments(
  before: Readonly<Record<string, BlockEntry>>,
  next: Readonly<Record<string, BlockEntry>>,
  current: readonly attachment.AttachmentDescriptor[],
  rawChange: unknown,
  sourceSha256: string,
): attachment.AttachmentDescriptor[] | undefined {
  let change: attachment.DocumentChange | undefined;
  let after: attachment.AttachmentDescriptor[] | undefined;
  try {
    change = rawChange === undefined ? undefined : attachment.documentChange(rawChange);
    if (change && attachment.emptyDocumentChange(change)) change = undefined;
    if (change) after = attachment.applyDocumentChange(current, change, sourceSha256);
  } catch {
    throw new AttachmentRefusal('invalid');
  }
  const list = after ?? current;
  const old = live(before);
  const now = live(next);
  for (const reference of now) {
    if (old.has(reference)) continue;
    const value = token(reference);
    if (value === undefined || resolve(value, list) === undefined) {
      throw new AttachmentRefusal('attachment');
    }
  }
  // A set may not make a live short reference ambiguous (see `admit` in `blocks/attachments.rs`).
  for (const reference of now) {
    if (!old.has(reference)) continue;
    const value = token(reference);
    if (value?.length === 8 && holders(current, value) === 1 && holders(list, value) > 1) {
      throw new AttachmentRefusal('attachment');
    }
  }
  for (const id of change?.remove ?? []) {
    for (const reference of now) {
      const value = token(reference);
      if (value !== undefined && resolve(value, current)?.attachmentId === id) {
        throw new AttachmentRefusal('attachment');
      }
    }
  }
  return after;
}
