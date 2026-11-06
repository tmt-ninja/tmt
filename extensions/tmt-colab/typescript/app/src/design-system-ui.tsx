import { BrowserAction, BrowserDialog, BrowserField } from '@tmt/browser-ui/react';
import { useId, useRef, useState } from 'react';
import {
  designSystemCreation,
  type CreationProgress,
  type DesignSystemCreation,
} from './design-system-pages.js';
import type { PageTransport } from './transport.js';
import './design-system-ui.css';

/*
 * The Design header's New design system dialog (#5821, epic #5866): it copies the TMT template
 * into a new top-level system. Everything runs in the browser on ordinary page operations.
 */

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function DesignSystemDialog({
  transport,
  onDismiss,
  onCreated,
}: {
  transport: PageTransport;
  onDismiss(): void;
  onCreated(rootId: string): void;
}) {
  const id = useId().replace(/:/g, '');
  const [name, setName] = useState('My design system');
  const [prefix, setPrefix] = useState('my-ui');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<CreationProgress>();
  // A started system keeps its name and prefix: Create again continues it, never a second copy.
  const creation = useRef<DesignSystemCreation>(undefined);
  const prefixValid = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(prefix);
  const create = async () => {
    setBusy(true);
    setError(undefined);
    creation.current ??= designSystemCreation(transport, { name: name.trim(), prefix });
    try {
      onCreated(await creation.current.run(setProgress));
    } catch (failure) {
      setError(message(failure));
      setBusy(false);
    }
  };
  const started = creation.current !== undefined;
  return (
    <BrowserDialog
      open
      title="New design system"
      onDismiss={() => {
        if (!busy) onDismiss();
      }}
      actions={
        <>
          <BrowserAction
            type="button"
            variant="secondary"
            label="Cancel"
            disabled={busy}
            onActivate={onDismiss}
          />
          <BrowserAction
            type="button"
            variant="primary"
            label={started && !busy ? 'Try again' : 'Create'}
            busy={busy}
            disabled={!name.trim() || !prefixValid}
            onActivate={() => void create()}
          />
        </>
      }
    >
      <div className="design-system-dialog">
        <p>
          Copies the TMT template into a new design system: a home page and one page per component,
          all editable. Then it publishes the first version.
        </p>
        <BrowserField
          controlId={`${id}-name`}
          label="Name"
          renderControl={(props) => (
            <input
              {...props}
              value={name}
              readOnly={started}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        />
        <BrowserField
          controlId={`${id}-prefix`}
          label="Tag prefix"
          description={`Components are written <${prefix || 'prefix'}-button>.`}
          descriptionId={`${id}-prefix-help`}
          error={prefixValid ? undefined : 'Lowercase words joined by hyphens, such as acme-ui.'}
          errorId={`${id}-prefix-error`}
          invalid={!prefixValid}
          renderControl={(props) => (
            <input
              {...props}
              value={prefix}
              readOnly={started}
              onChange={(event) => setPrefix(event.target.value)}
            />
          )}
        />
        {busy && progress && (
          <p role="status">
            {progress.phase === 'pages'
              ? `Writing pages: ${progress.done} of ${progress.total}`
              : 'Publishing the first version…'}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </BrowserDialog>
  );
}
