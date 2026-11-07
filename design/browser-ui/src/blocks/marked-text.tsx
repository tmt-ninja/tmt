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

/**
 * A block's text with its inline marks: bold, italic and code as text styles, a link as a link,
 * and an @agent or @block mark as the mention chip. Offsets count scalar values, as the page's
 * rich text does; marks outside the text are clipped. The page has checked every mark's value.
 */
export function MarkedText({
  text,
  marks = [],
  blockHref,
}: {
  text: string;
  marks?: readonly TextMarkRun[];
  /** Where an @block mark points, from the block's ID. */
  blockHref?(id: string): string;
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
    const link = has('link');
    if (link?.value)
      node = (
        <a className="tmt-block-link" href={link.value} target="_blank" rel="noreferrer">
          {node}
        </a>
      );
    const agent = has('agent');
    const block = has('block');
    if (agent) node = <BlockMention>{node}</BlockMention>;
    else if (block?.value)
      node = <BlockMention href={blockHref?.(block.value)}>{node}</BlockMention>;
    out.push(<span key={`${from}-${to}`}>{node}</span>);
  }
  return out;
}
