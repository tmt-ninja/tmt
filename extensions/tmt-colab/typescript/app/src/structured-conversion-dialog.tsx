import { BrowserAction, BrowserDialog } from '@tmt/browser-ui/react';
import { useRef } from 'react';

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
      presentation="confirm"
      title="Convert to a structured page?"
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
            label="Convert page"
            busy={busy}
            disabled={busy}
            onActivate={onConfirm}
          />
        </>
      }
    >
      <p>
        The structured page will start empty. The old HTML will remain in page history, where it can
        be recovered. An agent can read the old content and rebuild it with the block commands.
      </p>
    </BrowserDialog>
  );
}
