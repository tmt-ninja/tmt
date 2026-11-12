import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, AlertDescription, UiTheme } from '@tmt/browser-ui/ui';
import '@tmt/browser-ui/ui.css';
import { getTheme, subscribeTheme } from './theme.js';
import { ArrowUpRight, Clock3, Terminal, TriangleAlert } from 'lucide-react';
import {
  colabSettingsReferenceDefaults,
  colabSettingsSource,
  type ColabSettingsSource,
  type ColabSettingsUnavailable,
  type ColabSettingsView,
} from './colab-settings-source.js';
import { CopyCommand } from './copy-command.js';
import { BrowserTabs, type BrowserTab } from '@tmt/browser-ui/react';
import type { ManagementPort } from './management.js';
import { TemplateSettings } from './template-settings.js';
import { text } from './strings.js';
import './colab-settings.css';

/**
 * Colab settings: General (the CLI-managed values, read only) and Templates (#5077), the one
 * setting the browser changes, through the owner.
 */
export function ColabSettings({
  source = colabSettingsSource,
  management,
}: {
  source?: ColabSettingsSource;
  management?: ManagementPort;
}) {
  const [tab, setTab] = useState<'general' | 'templates'>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'templates'
      ? 'templates'
      : 'general',
  );
  const t = text.colabSettings;
  const tabs: BrowserTab[] = [
    {
      id: 'general',
      tabId: 'colab-settings-tab-general',
      panelId: 'colab-settings-general',
      label: text.templates.general,
    },
    {
      id: 'templates',
      tabId: 'colab-settings-tab-templates',
      panelId: 'colab-settings-templates',
      label: text.templates.title,
    },
  ];
  return (
    <section className="home colab-settings" aria-label={t.title}>
      <header className="colab-settings-hero">
        <p>{t.subtitle}</p>
      </header>
      <BrowserTabs
        label={t.title}
        tabs={tabs}
        selected={tab}
        variant="flush"
        onSelect={(id) => setTab(id === 'templates' ? 'templates' : 'general')}
      >
        {(current) =>
          current.id === 'templates' ? (
            // Read only once the tab is open: the panel stays mounted, its read does not.
            tab === 'templates' && <TemplateSettings management={management} />
          ) : (
            <GeneralSettings source={source} />
          )
        }
      </BrowserTabs>
    </section>
  );
}

/** The reference schema and a real injected read are distinct; no browser settings write exists. */
function GeneralSettings({ source }: { source: ColabSettingsSource }) {
  const [view, setView] = useState<ColabSettingsView | ColabSettingsUnavailable>();
  useEffect(() => {
    let live = true;
    setView(undefined);
    void source.read().then((next) => live && setView(next));
    return () => {
      live = false;
    };
  }, [source]);
  const theme = useSyncExternalStore(subscribeTheme, getTheme);
  const t = text.colabSettings;
  const unavailable = view && 'unavailable' in view ? view : undefined;
  const values = view && ('unavailable' in view ? colabSettingsReferenceDefaults : view);
  const reference = values?.sample === true;
  const heading = reference ? t.reference : t.current;
  const rows = values
    ? [
        { icon: ArrowUpRight, title: t.open, help: t.openHelp, value: values.open ? t.on : t.off },
        {
          icon: Clock3,
          title: t.expiry,
          help: t.expiryHelp,
          value: values.pageExpiryDays === null ? t.never : t.days(values.pageExpiryDays),
        },
      ]
    : [];
  return (
    <div className="colab-settings-general">
      {unavailable && (
        <UiTheme theme={theme}>
          <Alert role="note">
            <TriangleAlert aria-hidden className="colab-settings-warning" />
            <AlertDescription>
              <div className="colab-settings-handoff">
                <strong>{unavailable.unavailable}</strong>
                <p>{t.terminalHelp}</p>
                {unavailable.command && <CopyCommand command={unavailable.command} enabled />}
              </div>
            </AlertDescription>
          </Alert>
        </UiTheme>
      )}
      {values && (
        <section className="colab-settings-card" aria-labelledby="colab-settings-values">
          <div className="colab-settings-card-heading">
            <div>
              <h2 id="colab-settings-values">{heading}</h2>
              <p>{reference ? t.referenceHelp : t.readOnly}</p>
            </div>
            <span className="colab-settings-badge">
              <Terminal aria-hidden />
              {t.cliManaged}
            </span>
          </div>
          <dl className="colab-settings-rows">
            {rows.map(({ icon: Icon, title, help, value }) => (
              <div className="colab-settings-row" key={title}>
                <dt>
                  <span className="colab-settings-icon">
                    <Icon aria-hidden />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <span className="colab-settings-help">{help}</span>
                  </span>
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {values && (
        <p className="colab-settings-footer">
          {heading} · {t.readOnlyLabel}
        </p>
      )}
    </div>
  );
}
