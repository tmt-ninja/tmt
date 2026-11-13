import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type BaseSelection,
  type LexicalNode,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
} from 'lexical';
import { $isRichInputChip, ChipRemoveLabel, RichInputChipNode } from './chip-node.js';
import { RICH_INPUT_RESET_TAG, RichInputCore, type RichInputDocument } from './core.js';
import {
  $replaceRichInput,
  $richInputCaret,
  $richInputText,
  $richInputTokens,
  $selectRichInputRange,
  type RichInputRange,
} from './document.js';
import { chooseSuggestion, notifyChipRemoval } from './actions.js';
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
  /** Opt in to case-insensitive triggers and multi-word queries. */
  caseInsensitive?: boolean;
  allowSpaces?: boolean;
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
  /** Return true to handle a suggestion as an action rather than inserting a chip. */
  onSuggestionChoose?(
    kind: string,
    option: RichInputOption,
    valueWithoutQuery: RichInputValue,
  ): boolean;
  /** A chip was removed from the edited value, including by keyboard. */
  onChipRemove?(value: RichInputValue): void;
  /** Escape when no suggestions are open. */
  onEscape?(): void;
  /** A host with a listbox may expose the input as a combobox. */
  role?: 'combobox';
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
/** A collapsed caret before everything in the input. */
function $atStart(selection: BaseSelection) {
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.offset !== 0)
    return false;
  for (let node: LexicalNode | null = selection.anchor.getNode(); node; node = node.getParent())
    if (node.getPreviousSibling()) return false;
  return true;
}

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
/** The high-level input's value as the core's document: text with chips as ranges. */
const valueDocument: RichInputDocument<RichInputValue> = {
  read: $read,
  replace: $write,
  equal: same,
};

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
    const start = source.caseInsensitive
      ? before.toLocaleLowerCase().lastIndexOf(source.trigger.toLocaleLowerCase())
      : before.lastIndexOf(source.trigger);
    if (start < 0 || (start > 0 && !/\s/.test(before[start - 1]!))) continue;
    const query = before.slice(start + source.trigger.length);
    if (!source.allowSpaces && /\s/.test(query)) continue;
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
  // The core reports edits; the editor inside decides what an edit means for this shape.
  const edited = useRef<(value: RichInputValue) => void>(undefined);
  return (
    <ChipRemoveLabel.Provider value={props.removeLabel ?? ((_, text) => `Remove ${text}`)}>
      <RichInputCore
        edit={props.value}
        onChange={(value) => edited.current?.(value)}
        document={valueDocument}
        resetKey={props.resetKey}
        disabled={props.disabled ?? false}
      >
        <Editor {...props} edited={edited} />
      </RichInputCore>
    </ChipRemoveLabel.Provider>
  );
}

function Editor({
  edited,
  ...props
}: RichInputProps & { edited: { current?: (value: RichInputValue) => void } }) {
  const [editor] = useLexicalComposerContext();
  const listId = useId();
  const current = useRef(props);
  current.current = props;
  const [open, setOpen] = useState<Open>();
  const openRef = useRef(open);
  openRef.current = open;
  edited.current = (next) => {
    const props = current.current;
    if (props.shape === 'single' && next.value.includes('\n')) {
      // One line: a pasted or typed break becomes a space; the ranges keep their offsets.
      editor.update(() => $write({ ...next, value: next.value.replaceAll('\n', ' ') }), {
        discrete: true,
      });
      return;
    }
    props.onChange(next);
    notifyChipRemoval(props.value, next, props.onChipRemove);
  };
  // A keyboard or scripted focus lands after the content when the caret would sit at its start, so
  // typing goes on after the chips instead of before them. A pointer places its own caret.
  useEffect(() => {
    let pointer = false;
    // A press marks the focus it gives as a pointer's until that focus arrives. A mouse focuses in
    // the press's own task, but a touch focuses only after the finger lifts, several tasks later
    // (#6164). When no focus comes, whatever happens first ends the mark: the gesture's click
    // (wherever a drag ends), a cancelled press such as a scroll, the field losing focus, or any
    // key (a keyboard focus starts with one; a press released outside the window has no click).
    // So a later keyboard focus is never taken for a pointer's.
    const release = () => {
      pointer = false;
      document.removeEventListener('click', release, true);
      document.removeEventListener('pointercancel', release, true);
      document.removeEventListener('keydown', release, true);
    };
    const press = () => {
      pointer = true;
      document.addEventListener('click', release, true);
      document.addEventListener('pointercancel', release, true);
      document.addEventListener('keydown', release, true);
    };
    const land = () => {
      if (pointer) return release();
      // After the browser has put its own focus caret in the editor, and only while it is still
      // there: moving the caret of a field the user has left would take focus back.
      setTimeout(() => {
        if (!editor.getRootElement()?.contains(document.activeElement)) return;
        editor.update(
          () => {
            const selection = $getSelection();
            if (selection === null || $atStart(selection)) $getRoot().selectEnd();
          },
          { discrete: true },
        );
      });
    };
    const unregister = editor.registerRootListener((root, previous) => {
      previous?.removeEventListener('pointerdown', press);
      previous?.removeEventListener('focus', land);
      previous?.removeEventListener('blur', release);
      root?.addEventListener('pointerdown', press);
      root?.addEventListener('focus', land);
      root?.addEventListener('blur', release);
    });
    return () => {
      unregister();
      release();
    };
  }, [editor]);
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags, dirtyElements, dirtyLeaves }) => {
        if (tags.has(RICH_INPUT_RESET_TAG) || !(dirtyElements.size || dirtyLeaves.size)) return;
        const [next, caret] = editorState.read(() => [$read(), $richInputCaret()] as const);
        if (current.current.shape === 'single' && next.value.includes('\n')) return;
        const found = openQuery(next, caret, current.current.suggestions ?? []);
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
    const value = editor.getEditorState().read($read);
    const removedLength = shown.caret - shown.start;
    const withoutQuery: RichInputValue = {
      value: value.value.slice(0, shown.start) + value.value.slice(shown.caret),
      chips: value.chips.map((chip) =>
        chip.range.start >= shown.caret
          ? {
              ...chip,
              range: {
                start: chip.range.start - removedLength,
                end: chip.range.end - removedLength,
              },
            }
          : chip,
      ),
    };
    if (
      chooseSuggestion(current.current.onSuggestionChoose, shown.source.kind, option, withoutQuery)
    ) {
      editor.update(
        () => {
          $write(withoutQuery);
          $selectRichInputRange(shown.start, shown.start);
        },
        { tag: HISTORY_PUSH_TAG, discrete: true },
      );
    } else insertChip(editor, value, shown, option);
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const native = event.nativeEvent;
    if (event.target instanceof HTMLElement && event.target.closest('.tmt-rich-input-chip-remove'))
      return;
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
    if (event.key === 'Escape' && props.onEscape) {
      consume();
      props.onEscape();
      return;
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
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(undefined);
      }}
    >
      <div className="tmt-rich-input-line">
        {props.leading && <span className="tmt-rich-input-leading">{props.leading}</span>}
        <ContentEditable
          className="tmt-rich-input-text"
          role={props.role}
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
              onClick={(event) => {
                if (event.nativeEvent.isTrusted) choose(option);
              }}
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
