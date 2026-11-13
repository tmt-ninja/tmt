import { BrowserField } from '../react.js';
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useId,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer';
import { ReactExtension } from '@lexical/react/ReactExtension';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { PlainTextExtension } from '@lexical/plain-text';
import { HistoryExtension } from '@lexical/history';
import {
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  defineExtension,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical';
import { RichInputChipNode } from './chip-node.js';
import { $emptyRichInput } from './document.js';
import './core.css';

// The rich input's core (#5830): one Lexical editing lifetime and one editable surface. The
// high-level RichInput and host plugins (Colab's composer and page-list filter) build on it; hosts
// own their token meaning, keys and effects.

/** Tags a host replacement, so update listeners can tell it from an edit. */
export const RICH_INPUT_RESET_TAG = 'parent-rich-input-reset';

export type RichInputEdit = { value: string };
export type RichInputDocument<Edit extends RichInputEdit> = {
  /** Runs inside an editor-state read; caller tokens remain caller-owned. */
  read(previous: Edit): Edit;
  replace(edit: Edit): void;
  equal(a: Edit, b: Edit): boolean;
};
export type RichInputControlProps = {
  label: string;
  className?: string;
  placeholder?: string;
  disabled: boolean;
  /** `disabled` only because a write is in flight: not editable and marked busy, never greyed. */
  busy?: boolean;
  describedBy?: string;
  /** Presentation only, inside the input below text; grants no editor or send authority. */
  accessory?: ReactNode;
  /** Presentation only, inside the input above text, as `accessory` is below it. */
  header?: ReactNode;
  trigger?: HTMLAttributes<HTMLElement> & { ref: Ref<HTMLElement> };
  onKeyDownCapture?(event: KeyboardEvent<HTMLDivElement>): void;
};
export type RichInputCoreProps<Edit extends RichInputEdit> = RichInputControlProps & {
  edit: Edit;
  onChange(edit: Edit): void;
  autoFocus?: boolean;
  resetKey?: string | number;
  document: RichInputDocument<Edit>;
  children?: ReactNode;
};

// Stable module identity; every mount owns its own editor and undo history.
export const richInputExtension = defineExtension({
  name: 'TmtRichInput',
  namespace: 'TmtRichInput',
  nodes: [RichInputChipNode],
  dependencies: [PlainTextExtension, HistoryExtension, ReactExtension],
  $initialEditorState: $emptyRichInput,
  onError: (error: Error) => {
    throw error;
  },
});

/** The shared editing lifetime. Callers own token plugins and every effect outside editing. */
export function RichInputCore<Edit extends RichInputEdit>(props: RichInputCoreProps<Edit>) {
  return (
    <LexicalExtensionComposer extension={richInputExtension} contentEditable={null}>
      <EditingLifetime {...props} />
      {props.children ?? <RichInputControl {...props} />}
    </LexicalExtensionComposer>
  );
}
function EditingLifetime<Edit extends RichInputEdit>(props: RichInputCoreProps<Edit>) {
  const [editor] = useLexicalComposerContext();
  const current = useRef(props);
  current.current = props;
  const reset = useRef(props.resetKey);
  useEffect(() => {
    if (!props.autoFocus) return;
    // Inline editors can mount before Lexical attaches the editable root.
    return editor.registerRootListener((root) => {
      if (root) editor.focus(() => root.focus({ preventScroll: true }));
    });
  }, [editor, props.autoFocus]);
  const wasDisabled = useRef(props.disabled);
  useEffect(() => {
    const completed = wasDisabled.current && !props.disabled;
    wasDisabled.current = props.disabled;
    editor.setEditable(!props.disabled);
    if (
      completed &&
      props.autoFocus &&
      editor.getRootElement()?.closest('dialog[open], .tmt-ui-panel') &&
      document.activeElement === document.body
    )
      editor.focus();
  }, [editor, props.disabled, props.autoFocus]);
  useLayoutEffect(() => {
    const explicit = reset.current !== props.resetKey;
    reset.current = props.resetKey;
    const value = editor.getEditorState().read(() => props.document.read(props.edit));
    if (explicit || value.value !== props.edit.value) {
      const inside = editor.getRootElement()?.contains(document.activeElement) ?? false;
      editor.update(
        () => {
          props.document.replace(props.edit);
          // An editor the user is not in keeps no selection, so attaching its root never takes focus.
          if (!inside) $setSelection(null);
        },
        // A background editor replacement must not move the active editor's caret.
        {
          tag: inside ? RICH_INPUT_RESET_TAG : [RICH_INPUT_RESET_TAG, SKIP_DOM_SELECTION_TAG],
          discrete: true,
        },
      );
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }
  }, [editor, props.edit, props.document, props.resetKey]);
  // Attaching ContentEditable creates Lexical's decorator hosts during commit.
  // Read their external-store snapshot again before paint, rather than waiting
  // for the passive subscription to notice those hosts after the first frame.
  const [, refreshDecorators] = useReducer((revision: number) => revision + 1, 0);
  useLayoutEffect(refreshDecorators, [refreshDecorators]);
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags, dirtyElements, dirtyLeaves }) => {
        if (tags.has(RICH_INPUT_RESET_TAG) || !(dirtyElements.size || dirtyLeaves.size)) return;
        const props = current.current;
        const next = editorState.read(() => props.document.read(props.edit));
        if (!props.document.equal(next, props.edit)) props.onChange(next);
      }),
    [editor],
  );
  return null;
}

/** One editable surface and composition/trust guard, reused by each caller's keyboard policy. */
export function RichInputControl(props: RichInputControlProps) {
  const [editor] = useLexicalComposerContext();
  const controlId = useId();
  return (
    <BrowserField
      controlId={controlId}
      label={props.label}
      describedByIds={props.describedBy ? [props.describedBy] : []}
      renderControl={(field) => {
        const editable = (
          <ContentEditable
            {...props.trigger}
            {...field}
            onKeyDown={undefined}
            placeholder={null}
            aria-placeholder={undefined}
            className={`${field.className} rich-input-field ${props.className ?? ''}`}
            aria-multiline="true"
            aria-disabled={props.disabled && !props.busy}
            aria-busy={props.busy || undefined}
            ref={props.trigger?.ref as Ref<HTMLDivElement>}
            data-placeholder={props.placeholder}
            onKeyDownCapture={(event) => {
              const native = event.nativeEvent;
              if (
                !native.isTrusted ||
                native.isComposing ||
                editor.isComposing() ||
                native.keyCode === 229 ||
                props.disabled
              )
                return;
              props.onKeyDownCapture?.(event);
            }}
          />
        );
        // The surface never changes the editable's parent: adding/removing a row must
        // keep the mounted root, focus and DOM selection, including during typing.
        return (
          <div
            className="rich-input-surface"
            data-accessory={Boolean(props.accessory) || undefined}
            data-disabled={(props.disabled && !props.busy) || undefined}
          >
            {props.header}
            {editable}
            {props.accessory && <div className="rich-input-accessory">{props.accessory}</div>}
          </div>
        );
      }}
    />
  );
}
