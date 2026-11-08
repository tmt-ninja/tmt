import type { ReactNode } from 'react';
import { BlockMention } from './mention.js';
import './blocks.css';

/** One inline mark on a block's text, on scalar offsets `from..to` (the page's rich text). */
export interface TextMarkRun {
  from: number;
  to: number;
  mark: 'bold' | 'italic' | 'code' | 'link' | 'agent' | 'block';
  /** A link's URL, an agent's name or a block's ID. */
  value?: string;
}

/** A link mark's URL when its scheme may be opened: `https:`, `http:` or `mailto:`, lower-case,
 * with no space or control character (as the page's validator admits). Anything else — a
 * `javascript:` or `data:` URL — draws as plain text. */
export function linkHref(value: string | undefined): string | undefined {
  return value !== undefined &&
    /^(?:https?:\/\/|mailto:)[^\p{Cc}\p{Z}]+$/u.test(value) &&
    value.length <= 2048
    ? value
    : undefined;
}

/** A block mark's value as the validator admits it: a block ID on this page, or
 * `<pageId>/<blockId>` for a block on another page (generated v4 UUIDs). Anything else draws as a
 * plain mention with no link. */
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const BLOCK_REF = new RegExp(`^(?:(${ID})/)?(${ID})$`);

/**
 * A block's text with its inline marks: bold, italic and code as text styles, a link as a link,
 * and an @agent or @block mark as the mention chip. Offsets count scalar values, as the page's
 * rich text does; marks outside the text are clipped. A link opens only through `onLink`, the
 * page's trusted open path; a link whose scheme may not be opened is plain text.
 */
export function MarkedText({
  text,
  marks = [],
  blockHref,
  onLink,
}: {
  text: string;
  marks?: readonly TextMarkRun[];
  /** Where an @block mark points, from the block's ID and, for a block on another page, its page.
   * A mark on another page opens through `onLink`, never by the anchor. */
  blockHref?(id: string, page?: string): string | undefined;
  /** A link was activated: the page opens it (in a new tab when asked); the anchor never does. */
  onLink?(href: string, newTab: boolean): void;
}): ReactNode {
  const chars = Array.from(text);
  if (!marks.length) return text;
  const cuts = new Set([0, chars.length]);
  for (const run of marks) {
    cuts.add(Math.max(0, Math.min(chars.length, run.from)));
    cuts.add(Math.max(0, Math.min(chars.length, run.to)));
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const out: ReactNode[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i]!;
    const to = edges[i + 1]!;
    if (from === to) continue;
    const on = marks.filter((run) => run.from <= from && run.to >= to);
    let node: ReactNode = chars.slice(from, to).join('');
    const has = (mark: TextMarkRun['mark']) => on.find((run) => run.mark === mark);
    if (has('code')) node = <code className="tmt-block-inline-code">{node}</code>;
    if (has('italic')) node = <em>{node}</em>;
    if (has('bold')) node = <strong>{node}</strong>;
    const href = linkHref(has('link')?.value);
    if (href)
      node = (
        <a
          className="tmt-block-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            // The link opens; the block under it does not start editing.
            event.preventDefault();
            event.stopPropagation();
            onLink?.(href, event.metaKey || event.ctrlKey || event.shiftKey);
          }}
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            onLink?.(href, true);
          }}
        >
          {node}
        </a>
      );
    const agent = has('agent');
    const block = has('block');
    if (agent) node = <BlockMention>{node}</BlockMention>;
    else if (block) {
      const ref = block.value ? BLOCK_REF.exec(block.value) : null;
      const page = ref?.[1];
      const target = ref ? blockHref?.(ref[2]!, page) : undefined;
      node = (
        <BlockMention
          href={target}
          onClick={
            page && target
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onLink?.(target, event.metaKey || event.ctrlKey || event.shiftKey);
                }
              : undefined
          }
        >
          {node}
        </BlockMention>
      );
    }
    out.push(<span key={`${from}-${to}`}>{node}</span>);
  }
  return out;
}
