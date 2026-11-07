import { BrowserAction, BrowserDialog } from '@tmt/browser-ui/react';
import { useRef } from 'react';
import { text } from './strings.js';

/** Confirm replacement before the caller requests a revision-checked conversion. */
export function StructuredConversionDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const cancel = useRef<HTMLSpanElement>(null);
  return (
    <BrowserDialog
      open
      title={text.conversion.title}
      initialFocus={() => cancel.current?.querySelector('button') ?? null}
      onDismiss={() => {
        if (!busy) onCancel();
      }}
      actions={
        <>
          <span ref={cancel}>
            <BrowserAction
              type="button"
              variant="secondary"
              label="Cancel"
              disabled={busy}
              onActivate={onCancel}
            />
          </span>
          <BrowserAction
            type="button"
            variant="primary"
            label={text.conversion.convert}
            busy={busy}
            disabled={busy}
            onActivate={onConfirm}
          />
        </>
      }
    >
      <p>{text.conversion.body}</p>
    </BrowserDialog>
  );
}

// Reverting removes the blocks created after conversion, so show their count before confirmation.
export function StructuredRevertDialog({
  blockCount,
  busy,
  onCancel,
  onConfirm,
}: {
  blockCount: number;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const cancel = useRef<HTMLSpanElement>(null);
  return (
    <BrowserDialog
      open
      title={text.conversion.revertTitle}
      initialFocus={() => cancel.current?.querySelector('button') ?? null}
      onDismiss={() => {
        if (!busy) onCancel();
      }}
      actions={
        <>
          <span ref={cancel}>
            <BrowserAction
              type="button"
              variant="secondary"
              label="Cancel"
              disabled={busy}
              onActivate={onCancel}
            />
          </span>
          <BrowserAction
            type="button"
            variant="primary"
            label={text.conversion.revert}
            busy={busy}
            disabled={busy}
            onActivate={onConfirm}
          />
        </>
      }
    >
      <p>{text.conversion.revertBody(blockCount)}</p>
    </BrowserDialog>
  );
}
