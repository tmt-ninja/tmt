import { BrowserAction, BrowserDialog, BrowserField } from '@tmt/browser-ui/react';
import { useId, useState } from 'react';
import type { ComponentDoc, DesignSystemConfig } from '../../../../../design/systems/compiler.mjs';
import {
  createFromTemplate,
  nextVersion,
  publishDesignSystem,
  readBlock,
} from './design-system-pages.js';
import type { PageBinding, PageTransport } from './transport.js';
import './design-system-ui.css';

/*
 * The owner's design-system controls (#5821, epic #5866): a dialog that copies the TMT template
 * under the open page, and a band on a design-system page that publishes a version. Everything
 * runs in the browser on ordinary page operations.
 */

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function DesignSystemDialog({
  transport,
  binding,
  onDismiss,
  onCreated,
}: {
  transport: PageTransport;
  binding: PageBinding;
  onDismiss(): void;
  onCreated(rootId: string): void;
}) {
  const id = useId().replace(/:/g, '');
  const [name, setName] = useState('My design system');
  const [prefix, setPrefix] = useState('my-ui');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const prefixValid = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(prefix);
  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await createFromTemplate(transport, binding, name.trim(), prefix));
    } catch (failure) {
      setError(message(failure));
      setBusy(false);
    }
  };
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
            label="Create"
            busy={busy}
            disabled={!name.trim() || !prefixValid}
            onActivate={() => void create()}
          />
        </>
      }
    >
      <div className="design-system-dialog">
        <p>
          Copies the TMT template under this page: a design-system page and one page per component,
          all editable. Then it publishes the first version.
        </p>
        <BrowserField
          controlId={`${id}-name`}
          label="Name"
          renderControl={(props) => (
            <input {...props} value={name} onChange={(event) => setName(event.target.value)} />
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
            <input {...props} value={prefix} onChange={(event) => setPrefix(event.target.value)} />
          )}
        />
        {error && <p role="alert">{error}</p>}
      </div>
    </BrowserDialog>
  );
}

/** The band on a design-system or component page: what it is, and Publish on the root page. */
export function DesignSystemBand({
  transport,
  pageId,
  binding,
  source,
}: {
  transport: PageTransport;
  pageId: string;
  binding: PageBinding | undefined;
  source: string;
}) {
  const config = readBlock<DesignSystemConfig>(source, 'design-system');
  const component = config ? undefined : readBlock<ComponentDoc>(source, 'component');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  if (!config && !component) return null;
  if (component)
    return (
      <aside className="design-system-band" aria-label="Design system">
        <span>
          Component <code>{component.tag}</code>: edit its data block in Source, then publish from
          the design-system page.
        </span>
      </aside>
    );
  const latest = config!.releases.at(-1);
  const version = nextVersion(config!);
  const publish = async () => {
    if (!binding) return;
    setBusy(true);
    setStatus(undefined);
    try {
      const result = await publishDesignSystem(transport, pageId, binding, source, version);
      setStatus(`Published ${version}. Pin it with <meta name="tmt-ds" content="${result.pin}">`);
    } catch (failure) {
      setStatus(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="design-system-band" aria-label="Design system">
      <span>
        <b>{config!.name}</b> · <code>{config!.prefix}-</code> ·{' '}
        {latest ? `version ${latest.version}` : 'not published'} · {config!.components.length}{' '}
        component{config!.components.length === 1 ? '' : 's'}
      </span>
      {binding && (
        <BrowserAction
          type="button"
          variant="secondary"
          label={`Publish ${version}`}
          busy={busy}
          onActivate={() => void publish()}
        />
      )}
      {latest && (
        <code className="design-system-pin">{`<meta name="tmt-ds" content="${pageId}@${latest.version}#${latest.bundle}">`}</code>
      )}
      {status && <span role="status">{status}</span>}
    </aside>
  );
}
