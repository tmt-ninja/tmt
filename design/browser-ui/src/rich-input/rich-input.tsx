import {
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer';
import { ReactExtension } from '@lexical/react/ReactExtension';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { PlainTextExtension } from '@lexical/plain-text';
import { HistoryExtension } from '@lexical/history';
import {
  CLEAR_HISTORY_COMMAND,
  defineExtension,
  $setSelection,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG,
  type LexicalEditor,
} from 'lexical';
import { $isRichInputChip, ChipRemoveLabel, RichInputChipNode } from './chip-node.js';
import {
  $emptyRichInput,
  $replaceRichInput,
  $richInputCaret,
  $richInputText,
  $richInputTokens,
  $selectRichInputRange,
  type RichInputRange,
} from './document.js';
import './rich-input.css';

/** A chip in the value: its kind (`mention`, `project`, ...), its text and where it sits. */
export interface RichInputChip {
  kind: string;
  text: string;
  range: RichInputRange;
}
/** The input's whole value: plain text, with the chips as ranges over it. */
export interface RichInputValue {
  value: string;
  chips: RichInputChip[];
}
export interface RichInputOption {
  /** The chip text inserted, trigger included: `@sample-1`, `project:design`. */
  text: string;
  /** What the list shows, when it differs from the chip text. */
  label?: string;
}
/** A source of chips: typing `trigger` opens a list of its options for the query after it. */
export interface RichInputSuggestion {
  kind: string;
  trigger: string;
  options(query: string): readonly RichInputOption[];
}
export interface RichInputProps {
  /** single: a search field with chips; multi: a composer with mentions, toolbar and attachments. */
  shape: 'single' | 'multi';
  label: string;
  placeholder?: string;
  value: RichInputValue;
  onChange(value: RichInputValue): void;
  /** Enter, without Shift and outside an IME composition. */
  onSubmit?(value: RichInputValue): void;
  suggestions?: readonly RichInputSuggestion[];
  removeLabel?(kind: string, text: string): string;
  disabled?: boolean;
  /** Before the text, inside the field: a search icon. */
  leading?: ReactNode;
  /** After the text on the single line, or at the end of the multi-line footer: a send action. */
  trailing?: ReactNode;
  /** multi: formatting or attach actions under the text. */
  toolbar?: ReactNode;
  /** multi: the attachment tray, between the text and the toolbar. */
  attachments?: ReactNode;
  /** A changed key replaces the editor's content from `value` and clears its undo history. */
  resetKey?: string | number;
}

export const emptyRichInputValue: RichInputValue = { value: '', chips: [] };
const RESET_TAG = 'tmt-rich-input-reset';

const richInputExtension = defineExtension({
  name: 'TmtRichInput',
  namespace: 'TmtRichInput',
  nodes: [RichInputChipNode],
  dependencies: [PlainTextExtension, HistoryExtension, ReactExtension],
  $initialEditorState: $emptyRichInput,
  onError: (error: Error) => {
    throw error;
  },
});

const $read = (): RichInputValue => ({
  value: $richInputText(),
  chips: $richInputTokens($isRichInputChip).map(({ node, range }) => ({
    kind: node.getKind(),
    text: node.getTextContent(),
    range,
  })),
});
const $write = (value: RichInputValue) =>
  $replaceRichInput(
    value.value,
    value.chips.map((chip) => ({
      range: chip.range,
      create: () => new RichInputChipNode(chip.kind, chip.text),
    })),
  );
const same = (a: RichInputValue, b: RichInputValue) =>
  a.value === b.value &&
  a.chips.length === b.chips.length &&
  a.chips.every(
    (chip, index) =>
      chip.kind === b.chips[index]!.kind &&
      chip.text === b.chips[index]!.text &&
      chip.range.start === b.chips[index]!.range.start &&
      chip.range.end === b.chips[index]!.range.end,
  );

interface Open {
  source: RichInputSuggestion;
  start: number;
  caret: number;
  options: readonly RichInputOption[];
  active: number;
}

/** The query a trigger opened, if the caret sits in one: no space since the trigger, outside chips. */
function openQuery(
  value: RichInputValue,
  caret: number | undefined,
  sources: readonly RichInputSuggestion[],
): Omit<Open, 'active'> | undefined {
  if (caret === undefined) return undefined;
  const before = value.value.slice(0, caret);
  let best: Omit<Open, 'active'> | undefined;
  for (const source of sources) {
    const start = before.lastIndexOf(source.trigger);
    if (start < 0 || (start > 0 && !/\s/.test(before[start - 1]!))) continue;
    const query = before.slice(start + source.trigger.length);
    if (/\s/.test(query)) continue;
    if (value.chips.some((chip) => start < chip.range.end && caret > chip.range.start)) continue;
    if (!best || start > best.start)
      best = { source, start, caret, options: source.options(query).slice(0, 8) };
  }
  return best?.options.length ? best : undefined;
}

/** Insert `option` as a chip over the trigger and query, followed by one space; the caret after it. */
function insertChip(
  editor: LexicalEditor,
  value: RichInputValue,
  open: Open,
  option: RichInputOption,
) {
  const delta = option.text.length + 1 - (open.caret - open.start);
  const chips = value.chips
    .map((chip) =>
      chip.range.start >= open.caret
        ? { ...chip, range: { start: chip.range.start + delta, end: chip.range.end + delta } }
        : chip,
    )
    .concat({
      kind: open.source.kind,
      text: option.text,
      range: { start: open.start, end: open.start + option.text.length },
    })
    .sort((a, b) => a.range.start - b.range.start);
  const next = {
    value: `${value.value.slice(0, open.start)}${option.text} ${value.value.slice(open.caret)}`,
    chips,
  };
  const caret = open.start + option.text.length + 1;
  editor.update(
    () => {
      $write(next);
      $selectRichInputRange(caret, caret);
    },
    { tag: HISTORY_PUSH_TAG, discrete: true },
  );
}

/**
 * The rich input (#5821 A4): one Lexical editor in two shapes. The host owns the value, the chip
 * sources and what Enter does; the input owns editing, chips, the suggestion list and the keyboard:
 * Enter submits, Shift+Enter adds a line (multi only), Backspace after a chip removes it, Esc closes
 * an open suggestion list and is consumed there, and nothing acts during an IME composition. Paste is
 * plain text; on the single line a pasted line break becomes a space. Lexical ships in this entry
 * only (`@tmt/browser-ui/rich-input`), never in the shared bundle.
 */
export function RichInput(props: RichInputProps) {
  return (
    <ChipRemoveLabel.Provider value={props.removeLabel ?? ((_, text) => `Remove ${text}`)}>
      <LexicalExtensionComposer extension={richInputExtension} contentEditable={null}>
        <Editor {...props} />
      </LexicalExtensionComposer>
    </ChipRemoveLabel.Provider>
  );
}

function Editor(props: RichInputProps) {
  const [editor] = useLexicalComposerContext();
  const listId = useId();
  const current = useRef(props);
  current.current = props;
  const [open, setOpen] = useState<Open>();
  const openRef = useRef(open);
  openRef.current = open;
  const reset = useRef(props.resetKey);
  useEffect(() => editor.setEditable(!props.disabled), [editor, props.disabled]);
  useLayoutEffect(() => {
    const explicit = reset.current !== props.resetKey;
    reset.current = props.resetKey;
    const shown = editor.getEditorState().read($read);
    if (!explicit && same(shown, props.value)) return;
    const inside = editor.getRootElement()?.contains(document.activeElement) ?? false;
    editor.update(
      () => {
        $write(props.value);
        // An editor the user is not in keeps no selection, so attaching its root never takes focus.
        if (!inside) $setSelection(null);
      },
      // A background replacement must not move the caret of an editor the user is not in.
      { tag: inside ? RESET_TAG : [RESET_TAG, SKIP_DOM_SELECTION_TAG], discrete: true },
    );
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }, [editor, props.value, props.resetKey]);
  // Lexical creates its decorator hosts while ContentEditable attaches; read them again before paint.
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  useLayoutEffect(refresh, [refresh]);
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags, dirtyElements, dirtyLeaves }) => {
        if (tags.has(RESET_TAG) || !(dirtyElements.size || dirtyLeaves.size)) return;
        const props = current.current;
        const [next, caret] = editorState.read(() => [$read(), $richInputCaret()] as const);
        if (props.shape === 'single' && next.value.includes('\n')) {
          // One line: a pasted or typed break becomes a space; the ranges keep their offsets.
          editor.update(() => $write({ ...next, value: next.value.replaceAll('\n', ' ') }), {
            discrete: true,
          });
          return;
        }
        if (!same(next, props.value)) props.onChange(next);
        const found = openQuery(next, caret, props.suggestions ?? []);
        const was = openRef.current;
        setOpen(
          found && {
            ...found,
            active:
              was && was.source === found.source && was.start === found.start
                ? Math.min(was.active, found.options.length - 1)
                : 0,
          },
        );
      }),
    [editor],
  );
  const choose = (option: RichInputOption) => {
    const shown = openRef.current;
    if (!shown) return;
    setOpen(undefined);
    insertChip(editor, editor.getEditorState().read($read), shown, option);
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const native = event.nativeEvent;
    if (!native.isTrusted || native.isComposing || editor.isComposing() || native.keyCode === 229)
      return;
    const shown = openRef.current;
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (shown) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        consume();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setOpen({
          ...shown,
          active: (shown.active + step + shown.options.length) % shown.options.length,
        });
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        consume();
        choose(shown.options[shown.active]!);
        return;
      }
      if (event.key === 'Escape') {
        // The list takes this Esc; the window around the input keeps it open.
        consume();
        setOpen(undefined);
        return;
      }
    }
    if (event.key !== 'Enter') return;
    if (event.shiftKey && props.shape === 'multi') return;
    consume();
    if (!event.shiftKey) props.onSubmit?.(editor.getEditorState().read($read));
  };
  const active = open ? `${listId}-${open.active}` : undefined;
  const multi = props.shape === 'multi';
  return (
    <div
      className="tmt-rich-input"
      data-shape={props.shape}
      data-disabled={props.disabled || undefined}
      data-empty={!props.value.value || undefined}
    >
      <div className="tmt-rich-input-line">
        {props.leading && <span className="tmt-rich-input-leading">{props.leading}</span>}
        <ContentEditable
          className="tmt-rich-input-text"
          aria-label={props.label}
          aria-multiline={multi}
          aria-disabled={props.disabled || undefined}
          aria-autocomplete={props.suggestions?.length ? 'list' : undefined}
          aria-expanded={props.suggestions?.length ? Boolean(open) : undefined}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={active}
          data-placeholder={props.placeholder}
          placeholder={null}
          onKeyDownCapture={onKeyDownCapture}
        />
        {!multi && props.trailing}
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label={props.label} className="tmt-rich-input-list">
          {open.options.map((option, index) => (
            <li
              key={option.text}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === open.active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              {option.label ?? option.text}
            </li>
          ))}
        </ul>
      )}
      {multi && props.attachments && (
        <div className="tmt-rich-input-attachments">{props.attachments}</div>
      )}
      {multi && (props.toolbar || props.trailing) && (
        <div className="tmt-rich-input-footer">
          <div className="tmt-rich-input-toolbar">{props.toolbar}</div>
          {props.trailing}
        </div>
      )}
    </div>
  );
}
