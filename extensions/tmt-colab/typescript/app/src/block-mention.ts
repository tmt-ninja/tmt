import type { BlockRecord } from './block-model.js';
import type { BlockTree } from './block-tree.js';
import { validMarkValue } from './blocks.js';

/**
 * The @ picker of a page of blocks (#6203, spec "@ 一個區塊"): typing @ in a text block offers
 * the agents the page can name and the blocks on the page; the choice becomes an `agent` or `block`
 * mark over its chip text.
 */

/** One row of the @ menu: a mark to insert, or (#6208) another page to open, the way back from
 * it, or a Retry of its read. */
export interface MentionEntry {
  /** `agent:<name>`, `block:<id>`, `page:<id>`, `back` or `retry`. */
  id: string;
  /** What choosing the row does: insert this mark, open the page, go back or read again. */
  mark: 'agent' | 'block' | 'page' | 'back' | 'retry';
  /** An agent's name, a block's ID (`<pageId>/<blockId>` on another page), or a page's ID. */
  value: string;
  /** The chip's text, which the mark covers: `@name`, or a block's type and opening text. */
  label: string;
  /** The block's type, for its icon. */
  type?: string;
}

/** How many rows the menu shows. */
export const MENTION_ROWS = 8;
/** A query longer than this is not a mention any more. */
const QUERY_CHARS = 64;
/** How much of a block's text its chip shows. */
const OPENING_CHARS = 40;

/** A block type as a person reads it, in a chip and its accessible name. */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  list: 'List item',
  todo: 'To-do',
  table: 'Table',
  card: 'Card',
  question: 'Question',
  callout: 'Callout',
  code: 'Code',
  image: 'Image',
  mockup: 'Mockup',
  'work-bundle': 'Work bundle',
  'page-view': 'Page view',
};

/** A block's chip text: its type and opening text, as "Table: Ticket status". */
export function mentionLabel(block: BlockRecord): string {
  const name = TYPE_NAMES[block.type] ?? block.type;
  const source =
    block.text ??
    (typeof block.props.label === 'string' ? block.props.label : undefined) ??
    (typeof block.props.title === 'string' ? block.props.title : '');
  const opening = [...source.replace(/\s+/g, ' ').trim()]
    .slice(0, OPENING_CHARS)
    .join('')
    .trimEnd();
  return opening ? `${name}: ${opening}` : name;
}

/** The @ the caret is in: an @ at the text's start or after a space, then up to the caret no space
 * and no second @. Offsets are scalar, as the page's. */
export function mentionQuery(text: string, caret: number): { from: number; query: string } | null {
  const before = [...text].slice(0, caret);
  for (let at = before.length - 1; at >= 0 && before.length - at <= QUERY_CHARS + 1; at--) {
    const char = before[at]!;
    if (char === '@') {
      if (at > 0 && !/\s/u.test(before[at - 1]!)) return null;
      return { from: at, query: before.slice(at + 1).join('') };
    }
    if (/\s/u.test(char)) return null;
  }
  return null;
}

/** Whether every word of `query` starts a word of `label`, or `label` contains it, ignoring case. */
function matches(label: string, query: string): boolean {
  const typed = query.trim().toLowerCase();
  if (!typed) return true;
  const lower = label.toLowerCase();
  if (lower.includes(typed)) return true;
  const words = lower.split(/[\s:@_.-]+/u);
  return typed.split(/\s+/u).every((part) => words.some((word) => word.startsWith(part)));
}

/** Another page in the @ menu (#6208): the pages the page list offers, or the one opened. */
export type MentionPagesState =
  | { pages: readonly { id: string; title: string }[] }
  | {
      open: { id: string; title: string };
      state: 'loading' | 'failed' | 'ready';
      blocks?: readonly BlockRecord[];
    };

/** How many other pages' rows the menu shows. */
const PAGE_ROWS = 5;

/** The @ menu's rows for `query`: the agents first, then the page's blocks in reading order (not
 * the block typed in), at most `MENTION_ROWS`, then the other pages whose titles match. With a page
 * opened, the way back and that page's blocks (or its Retry). */
export function mentionEntries(
  tree: BlockTree,
  agents: readonly string[],
  query: string,
  self?: string,
  other?: MentionPagesState,
): MentionEntry[] {
  if (other && 'open' in other) {
    const back: MentionEntry = {
      id: 'back',
      mark: 'back',
      value: '',
      label: other.open.title,
    };
    if (other.state === 'failed')
      return [
        back,
        {
          id: 'retry',
          mark: 'retry',
          value: other.open.id,
          label: 'Could not read this page. Retry',
        },
      ];
    const rows = (other.blocks ?? [])
      .filter((block) => block.type !== 'row' && validMarkValue('block', block.id))
      .map((block): MentionEntry => ({
        id: `block:${other.open.id}/${block.id}`,
        mark: 'block',
        value: `${other.open.id}/${block.id}`,
        label: mentionLabel(block),
        type: block.type,
      }))
      .filter((entry) => matches(entry.label, query));
    return [back, ...rows.slice(0, MENTION_ROWS)];
  }
  const pages = (other?.pages ?? [])
    .filter(
      (page) => page.id !== self && validMarkValue('block', page.id) && matches(page.title, query),
    )
    .slice(0, PAGE_ROWS)
    .map((page): MentionEntry => ({
      id: `page:${page.id}`,
      mark: 'page',
      value: page.id,
      label: page.title,
    }));
  return [...thisPage(tree, agents, query, self), ...pages];
}

function thisPage(
  tree: BlockTree,
  agents: readonly string[],
  query: string,
  self?: string,
): MentionEntry[] {
  const people = [...new Set(agents)]
    .filter((name) => validMarkValue('agent', name))
    .map((name): MentionEntry => ({
      id: `agent:${name}`,
      mark: 'agent',
      value: name,
      label: `@${name}`,
    }));
  const blocks = tree
    .flat()
    .filter(
      (block) => block.id !== self && block.type !== 'row' && validMarkValue('block', block.id),
    )
    .map((block): MentionEntry => ({
      id: `block:${block.id}`,
      mark: 'block',
      value: block.id,
      label: mentionLabel(block),
      type: block.type,
    }));
  return [...people, ...blocks]
    .filter((entry) => matches(entry.label, query))
    .slice(0, MENTION_ROWS);
}
