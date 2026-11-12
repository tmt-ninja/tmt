import { useEffect, useRef, useState } from 'react';
import { getRouteApi, useRouter } from '@tanstack/react-router';
import { BrowserAction } from '@tmt/browser-ui/react';
import { Plus } from 'lucide-react';
import { NewPageDialog } from './new-page-dialog.js';
import { TemplateCard } from './template-card.js';
import type { ManagementPort } from './management.js';
import {
  catalogOrder,
  noteTemplates,
  type TemplateEntry,
  type TemplateListing,
} from './templates.js';
import { text } from './strings.js';
import './templates-page.css';

const rootRoute = getRouteApi('__root__');
const t = text.templates;
type Source = 'all' | 'builtIn' | 'space';

/** The owner's templates, read once per visit and again after a retry. */
export function useTemplateListing(management: ManagementPort | undefined) {
  const [listing, setListing] = useState<TemplateListing | 'failed'>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!management) return setListing('failed');
    const abort = new AbortController();
    setListing(undefined);
    management.readTemplates(abort.signal).then(
      (value) => {
        if (!abort.signal.aborted) setListing(noteTemplates(value));
      },
      () => {
        if (!abort.signal.aborted) setListing('failed');
      },
    );
    return () => abort.abort();
  }, [management, attempt]);
  return { listing, retry: () => setAttempt((n) => n + 1), set: setListing };
}

/**
 * Templates (#5077, screen 0): every template the owner lists, the default first, then TMT's, then
 * this space's; filters by source; Use opens New page with it chosen, and Open or Preview opens the
 * template's page (a TMT template has no page: Preview opens New page on it).
 */
export function TemplatesPage() {
  const { transport } = rootRoute.useRouteContext();
  const management = transport.management;
  const router = useRouter();
  const { listing, retry } = useTemplateListing(management);
  const [source, setSource] = useState<Source>('all');
  const [creating, setCreating] = useState<{ template?: string } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const templates = listing && listing !== 'failed' ? catalogOrder(listing.templates) : [];
  const counts = {
    all: templates.length,
    builtIn: templates.filter((tpl) => tpl.source === 'builtIn').length,
    space: templates.filter((tpl) => tpl.source === 'space').length,
  };
  const shown = templates.filter((tpl) => source === 'all' || tpl.source === source);
  const use = (tpl: TemplateEntry | undefined, from: HTMLElement) => {
    opener.current = from;
    setCreating({ template: tpl?.id ?? tpl?.name });
  };
  return (
    <section className="home templates-page" aria-label={t.title}>
      <header className="templates-head">
        <p className="templates-intro">{t.intro}</p>
        {management && (
          <BrowserAction
            type="button"
            variant="primary"
            label={text.pageList.newPage}
            leadingIcon={<Plus aria-hidden="true" />}
            onActivate={(event) => use(undefined, event.currentTarget)}
          />
        )}
      </header>
      {listing && listing !== 'failed' && listing.defaultGone && (
        <p className="templates-gone" role="note">
          {t.defaultGone(listing.defaultGone)}
        </p>
      )}
      {listing === undefined ? (
        <p className="templates-note" role="status">
          {t.loading}
        </p>
      ) : listing === 'failed' ? (
        <p className="templates-note" role="alert">
          {t.loadFailed}{' '}
          <button type="button" className="templates-link" onClick={retry}>
            {t.retry}
          </button>
        </p>
      ) : (
        <>
          <div className="templates-filters" role="radiogroup" aria-label={t.filterLabel}>
            {(['all', 'builtIn', 'space'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={source === key}
                className="templates-filter"
                onClick={() => setSource(key)}
              >
                {key === 'all' ? t.all : key === 'builtIn' ? t.tmt : t.thisSpace}
                <span className="templates-filter-count">{counts[key]}</span>
              </button>
            ))}
          </div>
          <div className="templates-grid">
            {shown.map((tpl) => (
              <TemplateCard
                key={tpl.name}
                template={tpl}
                actions={
                  <>
                    <BrowserAction
                      type="button"
                      variant="secondary"
                      presentation="compact"
                      label={`${t.use} ${tpl.name}`}
                      visibleLabel={t.use}
                      disabled={!management}
                      onActivate={(event) => use(tpl, event.currentTarget)}
                    />
                    <BrowserAction
                      type="button"
                      variant="ghost"
                      presentation="compact"
                      label={`${tpl.id ? t.open : t.preview} ${tpl.name}`}
                      visibleLabel={tpl.id ? t.open : t.preview}
                      onActivate={(event) => {
                        if (tpl.id)
                          void router.navigate({
                            to: '/pages/$pageId',
                            params: { pageId: tpl.id },
                          });
                        else use(tpl, event.currentTarget);
                      }}
                    />
                  </>
                }
              />
            ))}
          </div>
        </>
      )}
      <NewPageDialog
        open={creating !== null}
        onClose={() => setCreating(null)}
        focusFallback={() => opener.current}
        management={management}
        initialTemplate={creating?.template}
        onCreated={(pageId) => void router.navigate({ to: '/pages/$pageId', params: { pageId } })}
      />
    </section>
  );
}
