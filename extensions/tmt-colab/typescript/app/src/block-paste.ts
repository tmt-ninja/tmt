import { linkHref } from '@tmt/browser-ui/blocks';
import type { Mark } from './blocks.js';
import type { BlockType } from './block-model.js';

/** How many blocks one paste may make; a larger paste goes in as plain text (#6742). */
export const PASTE_BLOCKS = 200;

/** One block a paste makes: its type, text, marks (code-point offsets) and props. */
export interface PastedBlock {
  type: Extract<BlockType, 'paragraph' | 'heading' | 'list' | 'todo' | 'code'>;
  text: string;
  marks: Mark[];
  props?: Record<string, unknown>;
}

/** What a paste into a text block does: blocks to make, plain text because it was too large, or
 * the editor's own paste (one paragraph of text, a link, or nothing structured). */
export type Paste = { blocks: PastedBlock[] } | { tooLarge: true } | undefined;

const HEADINGS: Record<string, number> = { H1: 2, H2: 2, H3: 3, H4: 3, H5: 3, H6: 3 };
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'PRE', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'TR']);
const DROPPED = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
]);
const INLINE_MARKS: Record<string, Mark['mark']> = {
  B: 'bold',
  STRONG: 'bold',
  I: 'italic',
  EM: 'italic',
  CODE: 'code',
};

/** A line feed and a tab are the only control characters a block's text keeps. */
const clean = (text: string) =>
  [...text]
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return char === '\n' || char === '\t' || (code >= 0x20 && code !== 0x7f);
    })
    .join('');

/**
 * What pasting `html` or `text` into a block of `into`'s type makes (#6742). HTML is parsed into an
 * inert document (nothing in it loads or runs): headings, list items, paragraphs and preformatted
 * text become blocks; bold, italic, code and http(s)/mailto links stay as marks; anything else pastes
 * as its text, and an element with a `src` (an image, a frame) is dropped. Plain text splits into
 * paragraphs at blank lines; a single line feed stays inside its block. A code block, one paragraph
 * of plain text, or a lone link is left to the editor's own paste.
 */
export function pasted(into: BlockType, html: string, text: string): Paste {
  if (into === 'code') return undefined;
  const plain = text.trim();
  if (!html.trim() && (!plain || linkHref(plain))) return undefined;
  const blocks = html.trim() ? fromHtml(html) : fromText(text);
  if (!blocks) return undefined;
  if (blocks.length > PASTE_BLOCKS) return { tooLarge: true };
  // One plain paragraph is the editor's own paste: it keeps today's caret and undo.
  if (blocks.length === 1 && blocks[0]!.type === 'paragraph' && !blocks[0]!.marks.length)
    return undefined;
  return { blocks };
}

function fromText(text: string): PastedBlock[] | undefined {
  const parts = clean(text.replace(/\r\n?/g, '\n'))
    .split(/\n[ \t]*\n+/)
    .map((part) => part.replace(/^\n+|\n+$/g, ''))
    .filter((part) => part.trim());
  return parts.length > 1
    ? parts.map((part) => ({ type: 'paragraph', text: part, marks: [] }))
    : undefined;
}

function fromHtml(html: string): PastedBlock[] | undefined {
  if (typeof DOMParser !== 'function') return undefined;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: PastedBlock[] = [];
  let open: PastedBlock | undefined;
  const close = () => {
    if (open && open.text.trim()) {
      trimBlock(open);
      blocks.push(open);
    }
    open = undefined;
  };
  const start = (block: PastedBlock) => {
    close();
    open = block;
  };
  const inline = (node: Node, marks: Mark['mark'][], href: string | undefined) => {
    if (blocks.length > PASTE_BLOCKS) return;
    if (node.nodeType === Node.TEXT_NODE) {
      open ??= { type: 'paragraph', text: '', marks: [] };
      const value = clean(node.textContent ?? '').replace(/[\s ]+/g, (space) =>
        open!.type === 'code' ? space : space.includes(' ') ? ' ' : ' ',
      );
      if (!value) return;
      const from = [...open.text].length;
      open.text += value;
      const to = [...open.text].length;
      if (open.type !== 'code') {
        for (const mark of marks) open.marks.push({ from, to, mark });
        if (href) open.marks.push({ from, to, mark: 'link', value: href });
      }
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (DROPPED.has(tag) || node.hasAttribute('src')) return;
    if (tag === 'BR') {
      if (open) open.text += '\n';
      return;
    }
    // A table row is a paragraph with its cells apart, so it stays readable.
    if ((tag === 'TD' || tag === 'TH') && node.previousElementSibling && open?.text)
      open.text += ' | ';
    const level = HEADINGS[tag];
    if (level) {
      start({ type: 'heading', text: '', marks: [], props: { level } });
      for (const child of node.childNodes) inline(child, marks, href);
      close();
      return;
    }
    if (tag === 'PRE') {
      start({ type: 'code', text: '', marks: [] });
      open!.text = clean(node.textContent ?? '').replace(/\n$/, '');
      close();
      return;
    }
    if (tag === 'LI') {
      const box = node.querySelector('input[type="checkbox"]');
      const ordered = node.parentElement?.tagName === 'OL';
      start(
        box
          ? {
              type: 'todo',
              text: '',
              marks: [],
              ...((box as HTMLInputElement).hasAttribute('checked') && {
                props: { checked: true },
              }),
            }
          : { type: 'list', text: '', marks: [], props: { style: ordered ? 'number' : 'bullet' } },
      );
      for (const child of node.childNodes) {
        // A nested list is its own items, after this one.
        if (child instanceof Element && (child.tagName === 'UL' || child.tagName === 'OL')) {
          close();
          inline(child, marks, href);
        } else inline(child, marks, href);
      }
      close();
      return;
    }
    if (BLOCK_TAGS.has(tag) && !node.closest('li')) {
      close();
      for (const child of node.childNodes) inline(child, marks, href);
      close();
      return;
    }
    const mark = INLINE_MARKS[tag];
    const link = tag === 'A' ? linkHref(node.getAttribute('href') ?? undefined) : undefined;
    for (const child of node.childNodes)
      inline(child, mark && !marks.includes(mark) ? [...marks, mark] : marks, link ?? href);
  };
  for (const child of doc.body.childNodes) inline(child, [], undefined);
  close();
  return blocks.length ? blocks : undefined;
}

/** Leading and trailing spaces of a block go, and its marks follow the text that stays. */
function trimBlock(block: PastedBlock) {
  if (block.type === 'code') return;
  const scalars = [...block.text];
  let start = 0;
  let end = scalars.length;
  while (start < end && /[ \n]/.test(scalars[start]!)) start++;
  while (end > start && /[ \n]/.test(scalars[end - 1]!)) end--;
  block.text = scalars.slice(start, end).join('');
  block.marks = mergeMarks(
    block.marks
      .map((mark) => ({
        ...mark,
        from: Math.max(mark.from, start) - start,
        to: Math.min(mark.to, end) - start,
      }))
      .filter((mark) => mark.from < mark.to),
  );
}

/** Runs of one mark (and one link target) that touch become one. */
function mergeMarks(marks: Mark[]): Mark[] {
  const out: Mark[] = [];
  for (const mark of [...marks].sort((a, b) => a.from - b.from)) {
    const last = [...out]
      .reverse()
      .find((run) => run.mark === mark.mark && run.value === mark.value);
    if (last && last.to >= mark.from) last.to = Math.max(last.to, mark.to);
    else out.push({ ...mark });
  }
  return out.sort((a, b) => a.from - b.from || a.mark.localeCompare(b.mark));
}
