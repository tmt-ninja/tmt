import { useEffect, useRef, type KeyboardEvent } from 'react';
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer';
import { ReactExtension } from '@lexical/react/ReactExtension';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { PlainTextExtension } from '@lexical/plain-text';
import { HistoryExtension } from '@lexical/history';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  defineExtension,
  HISTORY_MERGE_TAG,
  type TextNode,
} from 'lexical';
import { linkHref } from '@tmt/browser-ui/blocks';
import type { Mark } from './blocks.js';

/** The editor's update tag for text the page sent, so the change is not reported back as typing. */
const PAGE_TAG = 'tmt-block-page-text';

const blockTextExtension = defineExtension({
  name: 'TmtBlockText',
  namespace: 'TmtBlockText',
  dependencies: [PlainTextExtension, HistoryExtension, ReactExtension],
  // Inline code draws as the design system's, as it does at rest (`MarkedText`).
  theme: { text: { code: 'tmt-block-inline-code' } },
  $initialEditorState: () => {
    $getRoot().append($createParagraphNode());
  },
  onError: (error: Error) => {
    throw error;
  },
});

/** Scalar offset `scalar` in `text` as a UTF-16 offset, and back: the merge counts scalar values,
 * the DOM and Lexical count UTF-16 units. */
export function utf16Offset(text: string, scalar: number): number {
  return [...text].slice(0, Math.max(0, scalar)).join('').length;
}
export function scalarOffset(text: string, utf16: number): number {
  return Array.from(text.slice(0, Math.max(0, utf16))).length;
}

const $text = () => $getRoot().getTextContent();
/** The DOM selection in `root` as scalar offsets into `text`: where it starts and ends (the caret
 * is `at`, its anchor), or the text's end when there is none. */
function domRange(root: HTMLElement, text: string): { at: number; from: number; to: number } {
  const selection = root.ownerDocument.getSelection();
  const end = [...text].length;
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode))
    return { at: end, from: end, to: end };
  const offset = (node: Node, at: number) => {
    const range = root.ownerDocument.createRange();
    range.setStart(root, 0);
    range.setEnd(node, at);
    return scalarOffset(text, range.toString().length);
  };
  const at = offset(selection.anchorNode!, selection.anchorOffset);
  const focus = root.contains(selection.focusNode)
    ? offset(selection.focusNode!, selection.focusOffset)
    : at;
  return { at, from: Math.min(at, focus), to: Math.max(at, focus) };
}
/** A Lexical point as a scalar offset in the block's text. */
const $scalar = (key: string, offset: number, type: 'text' | 'element'): number => {
  const text = $text();
  if (type === 'element') return offset === 0 ? 0 : [...text].length;
  let before = 0;
  for (const node of $getRoot().getAllTextNodes()) {
    if (node.getKey() === key) return scalarOffset(text, before + offset);
    before += node.getTextContentSize();
  }
  return [...text].length;
};
/** The selection as scalar offsets (anchor, focus), or the text's end when there is none. */
const $selected = (): { anchor: number; focus: number } => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    const end = [...$text()].length;
    return { anchor: end, focus: end };
  }
  const { anchor, focus } = selection;
  return {
    anchor: $scalar(anchor.key, anchor.offset, anchor.type),
    focus: $scalar(focus.key, focus.offset, focus.type),
  };
};
const $caret = (): number => $selected().anchor;

/** Lexical's text formats for the flag marks. A link draws with the design system's link look
 * (`.tmt-block-link`) as a node style; an @agent or @block mark draws as its text while typed in. */
const FORMATS = { bold: 'bold', italic: 'italic', code: 'code' } as const;
const LINK_STYLE =
  'color: var(--tmt-ui-color-text-action); text-decoration: underline; text-underline-offset: 2px';

/** The text split where its marks change, each part with the marks on it. */
function segments(text: string, marks: readonly Mark[] = []) {
  const chars = [...text];
  const cuts = new Set([0, chars.length]);
  for (const mark of marks) cuts.add(Math.min(mark.from, chars.length)).add(Math.min(mark.to, chars.length));
  const at = [...cuts].sort((a, b) => a - b);
  return at.slice(0, -1).map((from, i) => ({
    text: chars.slice(from, at[i + 1]).join(''),
    on: marks.filter((mark) => mark.from <= from && mark.to > from).map((mark) => mark.mark),
  }));
}

/** Replace the block's text and marks, and select scalar `anchor..focus` (a caret when equal). */
const $replace = (text: string, marks: readonly Mark[] | undefined, anchor: number, focus = anchor) => {
  const paragraph = $createParagraphNode();
  const nodes: TextNode[] = [];
  for (const part of segments(text, marks)) {
    const node = $createTextNode(part.text);
    for (const mark of part.on)
      if (mark in FORMATS) node.toggleFormat(FORMATS[mark as keyof typeof FORMATS]);
      else if (mark === 'link') node.setStyle(LINK_STYLE);
    nodes.push(node);
  }
  paragraph.append(...nodes);
  $getRoot().clear().append(paragraph);
  const point = (scalar: number): [string, number, 'text' | 'element'] => {
    let left = utf16Offset(text, scalar);
    for (const [i, node] of nodes.entries()) {
      const size = node.getTextContentSize();
      if (left <= size && (left < size || i === nodes.length - 1)) return [node.getKey(), left, 'text'];
      left -= size;
    }
    return [paragraph.getKey(), 0, 'element'];
  };
  const selection = $createRangeSelection();
  selection.anchor.set(...point(anchor));
  selection.focus.set(...point(focus));
  $setSelection(selection);
};
/** How text and marks look in the editor, as runs of one look: for telling whether the editor
 * already draws `marks`, so equal looks never redraw under the person's typing. */
function looks(parts: { text: string; format: number; styled: boolean }[]): string {
  const runs: { text: string; format: number; styled: boolean }[] = [];
  for (const part of parts) {
    const last = runs.at(-1);
    if (last && last.format === part.format && last.styled === part.styled) last.text += part.text;
    else if (part.text) runs.push({ ...part });
  }
  return JSON.stringify(runs);
}
const FORMAT_BITS = { bold: 1, italic: 2, code: 16 } as const;
const looksOf = (text: string, marks: readonly Mark[] | undefined) =>
  looks(
    segments(text, marks).map((part) => ({
      text: part.text,
      format: part.on.reduce((bits, mark) => bits | (FORMAT_BITS[mark as keyof typeof FORMAT_BITS] ?? 0), 0),
      styled: part.on.includes('link'),
    })),
  );
const $looks = () =>
  looks(
    $getRoot()
      .getAllTextNodes()
      .map((node) => ({
        text: node.getTextContent(),
        format: node.getFormat() & (1 | 2 | 16),
        styled: node.getStyle() !== '',
      })),
  );

/** A selected range as scalar offsets, `from` ≤ `to`. */
export interface TextRange {
  from: number;
  to: number;
}

export interface BlockTextEditorProps {
  /** Names the editor for assistive technology: the block's type and opening text. */
  label: string;
  /** The text to show. A change from the page replaces the editor's text and places the caret. */
  text: string;
  /** The text's marks: bold, italic and code as Lexical formats, a valued mark underlined. A
   * change to them alone redraws the text and keeps the selection. */
  marks?: readonly Mark[];
  /** Where the caret goes when `text` comes from the page, as a scalar offset. */
  caret: number;
  /** Moves with every text the page sends; the editor then shows `text` at `caret`. */
  version: number;
  /** The person typed: the editor's text and caret now. */
  onTyped(text: string, caret: number): void;
  /** Keys the block handles (Enter, Backspace at the start, Escape, the format keys); return true
   * to take one. `range` is the selection as scalar offsets, empty for a caret. */
  onKey?(event: KeyboardEvent, text: string, caret: number, range: TextRange): boolean;
  /** ⌘-click (Ctrl-click) on linked text: the page opens the link through its trusted path. */
  onLink?(href: string): void;
  /** A URL pasted over a selected range: the block may link the range instead of pasting. */
  onPasteUrl?(url: string, text: string, range: TextRange): boolean;
  placeholder?: string;
}

/**
 * One focused block's text in Lexical (#6005). Only the focused block holds an editor; every other
 * block draws as static content. Text from the page replaces the editor's text with the merged text
 * at the caret the merge gives (`BlockTextSync`), under its own tag, so it is never reported back as
 * typing and merges into the undo history step it interrupts.
 */
export function BlockTextEditor(props: BlockTextEditorProps) {
  return (
    <LexicalExtensionComposer extension={blockTextExtension} contentEditable={null}>
      <Editor {...props} />
    </LexicalExtensionComposer>
  );
}

function Editor({
  label,
  text,
  marks,
  caret,
  version,
  onTyped,
  onKey,
  onPasteUrl,
  onLink,
  placeholder,
}: BlockTextEditorProps) {
  const [editor] = useLexicalComposerContext();
  const typed = useRef(onTyped);
  typed.current = onTyped;
  useEffect(
    () =>
      editor.registerUpdateListener(({ tags, dirtyElements, dirtyLeaves, editorState }) => {
        if (tags.has(PAGE_TAG) || (dirtyElements.size === 0 && dirtyLeaves.size === 0)) return;
        editorState.read(() => typed.current($text(), $caret()));
      }),
    [editor],
  );
  useEffect(() => {
    if (editor.getEditorState().read($text) === text) return;
    editor.update(() => $replace(text, marks, caret), { tag: [PAGE_TAG, HISTORY_MERGE_TAG] });
    // Only a new text from the page moves the caret; the caret alone never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, version]);
  // New marks on the text the editor shows (a format key, another writer's) redraw it where the
  // selection is; marks for a text the editor no longer shows wait for that text.
  useEffect(() => {
    if (editor.isComposing()) return;
    const [now, drawn] = editor.getEditorState().read(() => [$text(), $looks()]);
    if (now !== text || drawn === looksOf(text, marks)) return;
    editor.update(
      () => {
        const { anchor, focus } = $selected();
        $replace(text, marks, anchor, focus);
      },
      { tag: [PAGE_TAG, HISTORY_MERGE_TAG] },
    );
  }, [editor, marks, text]);
  useEffect(() => editor.focus(), [editor]);
  return (
    <ContentEditable
      className="tmt-block-editor-text"
      aria-label={label}
      {...(placeholder
        ? {
            'aria-placeholder': placeholder,
            placeholder: (
              <div className="tmt-block-editor-placeholder" aria-hidden="true">
                {placeholder}
              </div>
            ),
          }
        : { placeholder: null })}
      onClickCapture={(event) => {
        if (!onLink || !(event.metaKey || event.ctrlKey)) return;
        const now = editor.getEditorState().read($text);
        const { at } = domRange(event.currentTarget, now);
        const run = marks?.find((mark) => mark.mark === 'link' && mark.from <= at && mark.to > at);
        const href = linkHref(run?.value);
        if (!href) return;
        event.preventDefault();
        onLink(href);
      }}
      onPasteCapture={(event) => {
        const url = event.clipboardData.getData('text/plain').trim();
        if (!onPasteUrl || !linkHref(url)) return;
        const now = editor.getEditorState().read($text);
        const { from, to } = domRange(event.currentTarget, now);
        if (from < to && onPasteUrl(url, now, { from, to })) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={(event) => {
        if (!onKey) return;
        // An IME composition owns its keys until it ends.
        if (event.nativeEvent.isComposing) return;
        const now = editor.getEditorState().read($text);
        // The caret from the DOM: Lexical takes a selection change on the next `selectionchange`,
        // so at a keydown its own selection can still be an earlier one.
        const { at, from, to } = domRange(event.currentTarget, now);
        if (onKey(event, now, at, { from, to })) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    />
  );
}
