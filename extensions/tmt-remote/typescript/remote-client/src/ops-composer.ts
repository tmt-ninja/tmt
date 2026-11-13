/** The Ops message box (#5704): the same pieces as Colab's composer, RichInputCore with
 * RichInputControl inside the Browser field, mounted as a React island. It is its own lazily
 * loaded module, so pages that never open a channel or DM never load React or Lexical. The host
 * owns sending: the box hands it the words and shows the host's state. */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, AtSign } from 'lucide-react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, HISTORY_PUSH_TAG } from 'lexical';
import { BrowserIconAction } from '@tmt/browser-ui/react';
import {
  $replaceRichInput,
  $richInputText,
  $selectRichInputRange,
  RichInputCore,
  type RichInputDocument,
  type RichInputEdit,
} from '@tmt/browser-ui/rich-input';
import { RichInputControl } from '@tmt/browser-ui/rich-input-control';
import type { ComposerHandle, ComposerOptions } from './ops-composer-types.js';

const plain: RichInputDocument<RichInputEdit> = {
  read: () => ({ value: $richInputText() }),
  replace: (edit) => $replaceRichInput(edit.value),
  equal: (a, b) => a.value === b.value,
};

/** `@` at the caret, the way the composer's toolbar starts a mention. */
function MentionAction(): ReactNode {
  const [editor] = useLexicalComposerContext();
  return h(BrowserIconAction, {
    type: 'button',
    variant: 'text',
    label: 'Mention an agent',
    icon: h(AtSign),
    onActivate: (event) => {
      if (!event.isTrusted) return;
      editor.update(
        () => {
          let selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            const end = $richInputText().length;
            $selectRichInputRange(end, end);
            selection = $getSelection();
          }
          if ($isRangeSelection(selection)) selection.insertText('@');
        },
        { tag: HISTORY_PUSH_TAG, discrete: true },
      );
      editor.focus();
    },
  });
}

function Composer({ options }: { options: ComposerOptions }): ReactNode {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reset, setReset] = useState(0);
  const cleared = useRef(options.cleared);
  useEffect(() => {
    if (cleared.current === options.cleared) return;
    cleared.current = options.cleared;
    setDrafts((all) => ({ ...all, [options.key]: '' }));
    setReset((value) => value + 1);
  }, [options.cleared, options.key]);
  const value = drafts[options.key] ?? '';
  const ready = options.canSend && !options.busy && value.trim() !== '';
  const send = () => {
    if (ready) options.onSend?.(value);
  };
  const control = h(RichInputControl, {
    label: options.label,
    placeholder: options.placeholder,
    disabled: options.busy,
    busy: options.busy,
    className: 'ops-composer-field',
    describedBy: options.describedBy,
    accessory: h(
      'div',
      { className: 'ops-composer-actions' },
      h(MentionAction),
      h('span', { className: 'ops-composer-hint' }, options.hint),
      h(BrowserIconAction, {
        type: 'button',
        variant: 'primary',
        label: 'Send',
        icon: h(ArrowUp),
        disabled: !ready,
        busy: options.busy,
        ...(options.canSend ? {} : { disabledReasonId: options.describedBy }),
        onActivate: (event) => {
          if (event.isTrusted) send();
        },
      }),
    ),
    onKeyDownCapture: (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      // The box takes this Enter; the editor must not also start a new line.
      event.preventDefault();
      event.stopPropagation();
      send();
    },
  });
  return h(RichInputCore<RichInputEdit>, {
    edit: { value },
    onChange: (next) => setDrafts((all) => ({ ...all, [options.key]: next.value })),
    document: plain,
    disabled: options.busy,
    resetKey: `${options.key}:${reset}`,
    children: control,
  });
}

export function mountComposer(host: HTMLElement, options: ComposerOptions): ComposerHandle {
  const root = createRoot(host);
  const render = (next: ComposerOptions) => root.render(h(Composer, { options: next }));
  render(options);
  return { update: render, unmount: () => root.unmount() };
}
