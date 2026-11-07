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
} from 'lexical';

/** The editor's update tag for text the page sent, so the change is not reported back as typing. */
const PAGE_TAG = 'tmt-block-page-text';

const blockTextExtension = defineExtension({
  name: 'TmtBlockText',
  namespace: 'TmtBlockText',
  dependencies: [PlainTextExtension, HistoryExtension, ReactExtension],
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
/** The caret as a scalar offset in the block's text, or its end when there is none. */
const $caret = (): number => {
  const text = $text();
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return [...text].length;
  const anchor = selection.anchor;
  let offset = 0;
  for (const node of $getRoot().getAllTextNodes()) {
    if (node.getKey() === anchor.key) return scalarOffset(text, offset + anchor.offset);
    offset += node.getTextContentSize();
  }
  return [...text].length;
};
/** Replace the block's text and put the caret at scalar `caret`. */
const $replace = (text: string, caret: number) => {
  const paragraph = $createParagraphNode();
  const node = $createTextNode(text);
  if (text) paragraph.append(node);
  $getRoot().clear().append(paragraph);
  const at = utf16Offset(text, caret);
  const selection = $createRangeSelection();
  if (text) {
    selection.anchor.set(node.getKey(), at, 'text');
    selection.focus.set(node.getKey(), at, 'text');
  } else {
    selection.anchor.set(paragraph.getKey(), 0, 'element');
    selection.focus.set(paragraph.getKey(), 0, 'element');
  }
  $setSelection(selection);
};

export interface BlockTextEditorProps {
  /** Names the editor for assistive technology: the block's type and opening text. */
  label: string;
  /** The text to show. A change from the page replaces the editor's text and places the caret. */
  text: string;
  /** Where the caret goes when `text` comes from the page, as a scalar offset. */
  caret: number;
  /** Moves with every text the page sends; the editor then shows `text` at `caret`. */
  version: number;
  /** The person typed: the editor's text and caret now. */
  onTyped(text: string, caret: number): void;
  /** Keys the block handles (Enter, Backspace at the start, Escape); return true to take one. */
  onKey?(event: KeyboardEvent, text: string, caret: number): boolean;
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
  caret,
  version,
  onTyped,
  onKey,
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
    editor.update(() => $replace(text, caret), { tag: [PAGE_TAG, HISTORY_MERGE_TAG] });
    // Only a new text from the page moves the caret; the caret alone never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, version]);
  useEffect(() => editor.focus(), [editor]);
  return (
    <ContentEditable
      className="tmt-block-editor-text"
      aria-label={label}
      data-placeholder={placeholder}
      placeholder={null}
      onKeyDownCapture={(event) => {
        if (!onKey) return;
        const [now, at] = editor.getEditorState().read(() => [$text(), $caret()] as const);
        if (onKey(event, now, at)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    />
  );
}
