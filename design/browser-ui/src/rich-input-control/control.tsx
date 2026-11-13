import { useId, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { BrowserField } from '../field.js';
import './control.css';

// The rich input's field surface (#5830), its own entry so the page runtime's RichInput never pulls
// in the browser field parts: hosts render it inside RichInputCore.

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
