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
export class BlockTextSync {
  /** The page text that local typing started from. */
  #base: string;
  /** What the editor shows now. */
  #local: string;
  /** The op on its way, with the base it was sent with. */
  #inflight?: { set: string; base: string };
  /** The page's latest text, while an op is in flight. */
  #held?: string;
  /** After an applied op, the text it replaced, until the page shows a newer one: the page can
   * still draw that text once more from a view made before the commit. */
  #stale?: string;

  constructor(
    readonly id: string,
    text: string,
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
    return { op: 'text', id: this.id, set: this.#local, base: this.#base, overlap: 'both' };
  }

  /** The page's text for the block is now `remote`. While an op is in flight it is held. */
  remote(remote: string, caret: number): Shown {
    if (this.#inflight) {
      this.#held = remote;
      return { text: this.#local, caret, dropped: false };
    }
    if (remote === this.#stale) return { text: this.#local, caret, dropped: false };
    this.#stale = undefined;
    return this.#merge(this.#base, remote, caret);
  }

  /** The op in flight settled: `applied` when the serve committed it (the page shows it), not when
   * it was refused (its typing stays local and goes in the next op). */
  settled(applied: boolean, caret: number): Shown {
    const sent = this.#inflight;
    if (!sent) return { text: this.#local, caret, dropped: false };
    this.#inflight = undefined;
    const from = applied ? sent.set : sent.base;
    this.#stale = applied && sent.base !== sent.set ? sent.base : undefined;
    const held = this.#held;
    this.#held = undefined;
    if (held === undefined || held === this.#stale) {
      this.#base = from;
      return { text: this.#local, caret, dropped: false };
    }
    this.#stale = undefined;
    return this.#merge(from, held, caret);
  }

  // The serve merges the browser's ops with `overlap: 'both'`, so the editor shows the same merge.
  #merge(from: string, remote: string, caret: number): Shown {
    if (remote === from) {
      this.#base = from;
      return { text: this.#local, caret, dropped: false };
    }
    const merged =
      this.#local === from
        ? { text: remote, dropped: [] }
        : textMerge.merge(from, remote, this.#local, 'both');
    const moved = caretThrough(this.#local, merged.text, caret);
    this.#base = remote;
    this.#local = merged.text;
    return { text: merged.text, caret: moved, dropped: merged.dropped.length > 0 };
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
