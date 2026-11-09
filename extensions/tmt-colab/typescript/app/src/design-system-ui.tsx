import { BrowserAction, BrowserDialog, BrowserField } from '@tmt/browser-ui/react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  designSystemCreation,
  type CreationProgress,
  type DesignSystemCreation,
} from './design-system-pages.js';
import type { PageTransport } from './transport.js';
import { SaveOutcomeUnknown } from './save.js';
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
  onCreated(rootId: string, open: boolean): void;
}) {
  const id = useId().replace(/:/g, '');
  const [name, setName] = useState('My design system');
  const [prefix, setPrefix] = useState('my-ui');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<CreationProgress>();
  const [stalled, setStalled] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const dismissed = useRef(false);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setStalled(true), 60_000);
    return () => clearTimeout(timer);
  }, [busy, progress]);
  // A started system keeps its name and prefix: Create again continues it, never a second copy.
  const creation = useRef<DesignSystemCreation>(undefined);
  const prefixValid = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(prefix);
  const create = async () => {
    setBusy(true);
    setStalled(false);
    setError(undefined);
    creation.current ??= designSystemCreation(transport, { name: name.trim(), prefix });
    try {
      const root = await creation.current.run((state) => {
        if (!dismissed.current) {
          setStalled(false);
          setProgress(state);
        }
      });
      onCreated(root, !dismissed.current);
    } catch (failure) {
      if (!dismissed.current) {
        const unknown = failure instanceof SaveOutcomeUnknown;
        setUncertain(unknown);
        setError(
          unknown
            ? 'Could not confirm some pages. Check the page list before starting again.'
            : message(failure),
        );
        setBusy(false);
        setStalled(false);
      }
    }
  };
  const started = creation.current !== undefined;
  return (
    <BrowserDialog
      open
      title="New design system"
      onDismiss={() => {
        dismissed.current = true;
        onDismiss();
      }}
      actions={
        <>
          <BrowserAction
            type="button"
            variant="secondary"
            label={started ? 'Close' : 'Cancel'}
            onActivate={() => {
              dismissed.current = true;
              onDismiss();
            }}
          />
          {!uncertain && (
            <BrowserAction
              type="button"
              variant="primary"
              label={busy ? 'Creating…' : started ? 'Try again' : 'Create'}
              busy={busy}
              disabled={busy || !name.trim() || !prefixValid}
              onActivate={() => void create()}
            />
          )}
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
              disabled={started}
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
              disabled={started}
              readOnly={started}
              onChange={(event) => setPrefix(event.target.value)}
            />
          )}
        />
        {busy && (
          <p role="status">
            {stalled
              ? `Still creating${progress && progress.phase !== 'publishing' ? ` (${progress.done}/${progress.total})` : ''}. This can take a while.`
              : progress?.phase === 'creating'
                ? `Creating pages: ${progress.done} of ${progress.total}`
                : progress?.phase === 'pages'
                  ? `Writing pages: ${progress.done} of ${progress.total}`
                  : progress?.phase === 'publishing'
                    ? 'Publishing the first version…'
                    : 'Preparing the design system…'}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </BrowserDialog>
  );
}
