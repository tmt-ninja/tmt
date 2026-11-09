import { textMerge } from '@tmt/colab-client';
import type { BlockOp } from './block-model.js';

/** How long typing rests before its edit is sent (#6005): a burst is one op. */
export const TEXT_FLUSH_MS = 300;

/** A character no block text holds, marking the caret while a merge moves it. */
const CARET = '﷐';

/** What the editor shows after the page's text changed. */
export interface Shown {
  readonly text: string;
  /** The caret's scalar offset in `text`. */
  readonly caret: number;
  /** Part of the local typing overlapped another writer's change there and was not kept. */
  readonly dropped: boolean;
  /** The text the editor showed when this was made. Keys it takes before it draws `text` merge onto
   * `text` from here, as typing merges onto the page's text (#6221). */
  readonly from: string;
}

/**
 * One focused text block's edits while the page also changes (#6005). The person's typing stays
 * local and is sent as one whole-text op with its merge base, so typing never waits on the network.
 * The editor shows `textMerge.merge(base, page, local)`: the same merge the serve applies, so both
 * sides agree on the result, and the caret moves through that same merge.
 *
 * One op is in flight at a time. The page can show that op before its save settles, so while it is
 * in flight the page's text is held, not merged; once the save settles (the binding's `edit`
 * resolves only after the page shows it) the held text is merged from the text that was sent, or,
 * for a refused op, from the old base, so the person's newer typing is never mistaken for a
 * conflict with their own sent edit.
 */
/** A table cell: its table and column; the row is the sync's `id`. */
export interface TableCell {
  readonly table: string;
  readonly column: string;
}

export class BlockTextSync {
  /** The page text that local typing started from. */
  #base: string;
  /** What the editor shows now. */
  #local: string;
  /** The op on its way, with the base it was sent with. */
  #inflight?: { set: string; base: string };
  /** The page's latest text while an op is in flight, with the order of the view it came from. */
  #held?: { text: string; seq?: number };
  /** The first view order that shows the last applied op: a view below it predates the commit,
   * however many of them arrive late. */
  #after = -Infinity;

  constructor(
    readonly id: string,
    text: string,
    /** A table cell's text instead of a block's: `id` is its row. */
    readonly cell?: TableCell,
  ) {
    this.#base = text;
    this.#local = text;
  }

  /** The page text the next op merges from. */
  get base(): string {
    return this.#base;
  }
  /** The text the editor shows. */
  get text(): string {
    return this.#local;
  }
  /** Whether the editor holds typing the page has not been sent or does not show yet. */
  get pending(): boolean {
    return this.#local !== this.#base;
  }
  /** Whether an op is on its way. */
  get sending(): boolean {
    return this.#inflight !== undefined;
  }

  /** The person typed: the editor now shows `text`. */
  typed(text: string): void {
    this.#local = text;
  }

  /** The op for typing not sent yet, or none (nothing new, or an op already on its way). */
  flush(): BlockOp | undefined {
    if (this.#inflight || this.#local === this.#base) return undefined;
    this.#inflight = { set: this.#local, base: this.#base };
    return this.cell
      ? {
          op: 'table',
          id: this.cell.table,
          action: 'set-cell',
          row: this.id,
          column: this.cell.column,
          text: this.#local,
          base: this.#base,
          overlap: 'both',
        }
      : { op: 'text', id: this.id, set: this.#local, base: this.#base, overlap: 'both' };
  }

  /** The page's text for the block is now `remote`, from a view of order `seq` (`PageView.seq`;
   * absent when the page gives none, and then taken as current). A view older than the last
   * applied op is dropped; while an op is in flight the text is held. */
  remote(remote: string, caret: number, seq?: number): Shown {
    const from = this.#local;
    if (seq !== undefined && seq < this.#after) return { text: from, caret, dropped: false, from };
    if (this.#inflight) {
      this.#held = { text: remote, seq };
      return { text: from, caret, dropped: false, from };
    }
    return this.#merge(this.#base, remote, caret);
  }

  /** The op in flight settled: `applied` when the serve committed it (the page shows it from view
   * order `seq` on), not when it was refused (its typing stays local and goes in the next op). A
   * held text from a view before the commit is dropped. */
  settled(applied: boolean, caret: number, seq?: number): Shown {
    const sent = this.#inflight;
    if (!sent) return { text: this.#local, caret, dropped: false, from: this.#local };
    this.#inflight = undefined;
    const from = applied ? sent.set : sent.base;
    if (applied && seq !== undefined) this.#after = Math.max(this.#after, seq);
    const held = this.#held;
    this.#held = undefined;
    if (held === undefined || (held.seq !== undefined && held.seq < this.#after)) {
      this.#base = from;
      return { text: this.#local, caret, dropped: false, from: this.#local };
    }
    return this.#merge(from, held.text, caret);
  }

  // The serve merges the browser's ops with `overlap: 'both'`, so the editor shows the same merge.
  #merge(from: string, remote: string, caret: number): Shown {
    const shown = this.#local;
    if (remote === from) {
      this.#base = from;
      return { text: shown, caret, dropped: false, from: shown };
    }
    const merged =
      this.#local === from
        ? { text: remote, dropped: [] }
        : textMerge.merge(from, remote, this.#local, 'both');
    const moved = caretThrough(this.#local, merged.text, caret);
    this.#base = remote;
    this.#local = merged.text;
    return { text: merged.text, caret: moved, dropped: merged.dropped.length > 0, from: shown };
  }
}

/** Where a caret at scalar `caret` in `before` lands in `after`: the caret is a one-character
 * insertion merged onto the change, so it follows the same rule as any other edit. Where the
 * change replaced the caret's place it stays at its offset, within the new text. */
export function caretThrough(before: string, after: string, caret: number): number {
  const scalars = [...before];
  const at = Math.max(0, Math.min(caret, scalars.length));
  const clamped = Math.min(at, [...after].length);
  if (before.includes(CARET) || after.includes(CARET)) return clamped;
  const marked = [...scalars.slice(0, at), CARET, ...scalars.slice(at)].join('');
  const index = [...textMerge.merge(before, after, marked).text].indexOf(CARET);
  return index < 0 ? clamped : index;
}
