import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { BrowserAction } from '@tmt/browser-ui/react';
import type { ManagementPort } from './management.js';
import { useTemplateListing } from './templates-page.js';
import { catalogOrder } from './templates.js';
import { Toast, useToast } from './template-toast.js';
import { text } from './strings.js';
import './template-settings.css';

const t = text.templates;

/**
 * Colab settings › Templates (#5077, screen 4): the default chosen with a radio per row, each
 * template's description, layout, source and how many pages were made from it. A change applies at
 * once (`template.default`) and is confirmed in a toast; a failed one keeps the old default.
 */
export function TemplateSettings({ management }: { management: ManagementPort | undefined }) {
  const router = useRouter();
  const { listing, retry, set } = useTemplateListing(management);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [toast, show] = useToast();
  if (listing === undefined)
    return (
      <p className="template-settings-note" role="status">
        {t.loading}
      </p>
    );
  if (listing === 'failed')
    return (
      <p className="template-settings-note" role="alert">
        {t.loadFailed}{' '}
        <button type="button" className="template-settings-link" onClick={retry}>
          {t.retry}
        </button>
      </p>
    );
  const builtIn = listing.templates.filter((tpl) => tpl.source === 'builtIn');
  const own = catalogOrder(listing.templates.filter((tpl) => tpl.source === 'space'));
  async function choose(selector: string | null) {
    if (busy || !management || listing === undefined || listing === 'failed') return;
    setBusy(true);
    setError(undefined);
    try {
      const now = await management.setDefaultTemplate(selector);
      set({
        ...listing,
        default: now,
        defaultGone: undefined,
        templates: listing.templates.map((tpl) => ({ ...tpl, default: tpl.name === now })),
      });
      show(t.defaultSet(now));
    } catch {
      setError(t.defaultFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="template-settings">
      <p className="template-settings-help">{t.settingsHelp}</p>
      {listing.defaultGone && (
        <p className="template-settings-gone" role="note">
          {t.defaultGone(listing.defaultGone)}
        </p>
      )}
      {error && (
        <p className="template-settings-error" role="alert">
          {error}
        </p>
      )}
      <table className="template-settings-table">
        <thead>
          <tr>
            <th scope="col">{t.columns.default}</th>
            <th scope="col">{t.columns.template}</th>
            <th scope="col">{t.columns.layout}</th>
            <th scope="col">{t.columns.source}</th>
            <th scope="col">{t.columns.usedBy}</th>
            <th scope="col">
              <span className="template-settings-hidden">{t.open}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...builtIn, ...own].map((tpl) => (
            <tr key={tpl.name}>
              <td data-label={t.columns.default}>
                <input
                  type="radio"
                  name="colab-default-template"
                  aria-label={`${t.columns.default}: ${tpl.name}`}
                  checked={tpl.default}
                  disabled={busy || !management}
                  onChange={() => void choose(tpl.name === 'starter' ? null : (tpl.id ?? tpl.name))}
                />
              </td>
              <td data-label={t.columns.template}>
                <strong className="template-settings-name">{tpl.name}</strong>
                <span className="template-settings-summary">{tpl.summary}</span>
              </td>
              <td data-label={t.columns.layout}>{t.layouts[tpl.layout] ?? tpl.layout}</td>
              <td data-label={t.columns.source}>
                {tpl.source === 'builtIn' ? (
                  <span className="template-badge" data-kind="tmt">
                    {t.tmt}
                  </span>
                ) : (
                  <span className="template-badge" data-kind="template">
                    {tpl.author ?? t.thisSpace}
                  </span>
                )}
              </td>
              <td data-label={t.columns.usedBy} data-empty={tpl.source === 'builtIn' || undefined}>
                {tpl.source === 'builtIn' ? '—' : t.usedBy(tpl.usedBy)}
              </td>
              <td>
                <BrowserAction
                  type="button"
                  variant="secondary"
                  presentation="compact"
                  label={`${tpl.id ? t.open : t.preview} ${tpl.name}`}
                  visibleLabel={tpl.id ? t.open : t.preview}
                  onActivate={() =>
                    void (tpl.id
                      ? router.navigate({ to: '/pages/$pageId', params: { pageId: tpl.id } })
                      : router.navigate({ to: '/templates' }))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Toast message={toast} />
    </div>
  );
}
