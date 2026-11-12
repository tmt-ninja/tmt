import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  BrowserAction,
  BrowserDialog,
  BrowserDisclosure,
  BrowserField,
} from '@tmt/browser-ui/react';
import { Plus } from 'lucide-react';
import { CopyCommand } from './copy-command.js';
import { ManagementError, type ManagementPort } from './management.js';
import { TemplateBadges, templateMeta } from './template-card.js';
import {
  createCommand,
  noteTemplates,
  pickerOrder,
  type TemplateEntry,
  type TemplateListing,
} from './templates.js';
import { text } from './strings.js';
import './new-page-dialog.css';

const t = text.templates;
/** The filter field and source chips appear once the list is longer than this. */
const FILTER_FROM = 6;
const RECENT_KEY = 'colab-recent-templates';
const CREATOR_KEY = 'colab-new-page-creator';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private window keeps no preference; creating still works.
  }
}
/** The templates this browser created pages from, newest first. */
export function recentTemplates(): string[] {
  try {
    const value: unknown = JSON.parse(stored(RECENT_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
function rememberTemplate(name: string) {
  store(
    RECENT_KEY,
    JSON.stringify([name, ...recentTemplates().filter((n) => n !== name)].slice(0, 8)),
  );
}

type Source = 'all' | 'builtIn' | 'space';
type Agents =
  | { state: 'loading' }
  | { state: 'ready'; agents: { id: string; name: string }[] }
  | { state: 'failed' };
interface Props {
  open: boolean;
  onClose(): void;
  focusFallback(): HTMLElement | null;
  /** The owner; without one (a read-only adapter) the dialog gives the terminal command only. */
  management?: ManagementPort;
  /** Preselect this template (Use on a template). */
  initialTemplate?: string;
  onCreated?(pageId: string): void;
  /** Browse all templates: the Templates page. */
  onBrowse?(): void;
}

/**
 * New page (#5076, #5077): a title, a template from cards, and a creator. Create page makes the
 * page on this machine through the owner (`page.new`) and opens it. An attempt that may have
 * reached the owner keeps its operation ID, so a retry after a lost reply finds the page it made.
 */
export function NewPageDialog({ open, ...props }: Props) {
  return open ? <NewPage {...props} /> : null;
}

function NewPage({
  onClose,
  focusFallback,
  management,
  initialTemplate,
  onCreated,
  onBrowse,
}: Omit<Props, 'open'>) {
  const ids = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState('');
  const [listing, setListing] = useState<TemplateListing | 'failed'>();
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string | undefined>(initialTemplate);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<Source>('all');
  const [agents, setAgents] = useState<Agents>({ state: 'loading' });
  const [creator, setCreator] = useState<string>(() => stored(CREATOR_KEY) ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [titleError, setTitleError] = useState(false);
  /** The operation of the last attempt that may have reached the owner, kept for a retry. */
  const operation = useRef<{ id: string; key: string } | undefined>(undefined);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => {
    if (!management) return;
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
  useEffect(() => {
    let live = true;
    const read = management?.agents?.();
    if (!read) {
      setAgents({ state: 'failed' });
      return;
    }
    read.then(
      (agents) => {
        if (live) setAgents({ state: 'ready', agents });
      },
      () => {
        if (live) setAgents({ state: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [management]);

  const ordered = useMemo(
    () =>
      listing && listing !== 'failed' ? pickerOrder(listing.templates, recentTemplates()) : [],
    [listing],
  );
  const filtering = ordered.length > FILTER_FROM;
  const counts = {
    all: ordered.length,
    builtIn: ordered.filter((tpl) => tpl.source === 'builtIn').length,
    space: ordered.filter((tpl) => tpl.source === 'space').length,
  };
  const needle = query.trim().toLowerCase();
  const shown = ordered.filter(
    (tpl) =>
      (source === 'all' || tpl.source === source) &&
      (!needle ||
        tpl.name.includes(needle) ||
        tpl.summary.toLowerCase().includes(needle) ||
        (tpl.author ?? '').toLowerCase().includes(needle)),
  );
  const chosen: TemplateEntry | undefined =
    ordered.find((tpl) => tpl.name === picked || tpl.id === picked) ??
    ordered.find((tpl) => tpl.default);
  const creatorAgent =
    agents.state === 'ready' ? agents.agents.find((agent) => agent.id === creator) : undefined;

  async function create() {
    if (busy || !management || !chosen) return;
    const name = title.trim();
    if (!name) {
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    const key = JSON.stringify([name, chosen.name, creatorAgent?.id ?? '']);
    // The same request again (a retry) keeps its operation, so a page already made is found.
    if (operation.current?.key !== key) operation.current = { id: crypto.randomUUID(), key };
    setBusy(true);
    setError(undefined);
    try {
      const pageId = await management.newPage({
        operationId: operation.current.id,
        title: name,
        template: chosen.id ?? chosen.name,
        ...(creatorAgent ? { creator: { agent: creatorAgent } } : {}),
      });
      rememberTemplate(chosen.name);
      store(CREATOR_KEY, creatorAgent?.id ?? '');
      if (!alive.current) return;
      onCreated?.(pageId);
      onClose();
    } catch (failure) {
      if (!alive.current) return;
      const code = failure instanceof ManagementError ? failure.code : 'UNKNOWN';
      // A refusal wrote nothing, so a new attempt may use a new operation.
      if (code !== 'UNKNOWN' && code !== 'UNAVAILABLE') operation.current = undefined;
      setError(t.createRefused(code));
      setBusy(false);
    }
  }

  /** Arrows move the selection through the cards (the list keeps focus); Enter creates. */
  function move(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void create();
      return;
    }
    if (!shown.length) return;
    const columns = listRef.current
      ? getComputedStyle(listRef.current).gridTemplateColumns.split(' ').length
      : 1;
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    const index = Math.max(
      0,
      shown.findIndex((tpl) => tpl.name === chosen?.name),
    );
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = shown.length - 1;
    else if (event.key in steps)
      next = Math.min(shown.length - 1, Math.max(0, index + steps[event.key]!));
    else return;
    event.preventDefault();
    const target = shown[next]!;
    setPicked(target.name);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-template="${CSS.escape(target.name)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  const optionId = (name: string) => `${ids}-option-${name}`;
  return (
    <BrowserDialog
      open
      size="wide"
      title={t.newPageTitle}
      onDismiss={() => {
        if (!busy) onClose();
      }}
      initialFocus={() => titleRef.current}
      focusFallback={focusFallback}
      actions={
        <>
          <BrowserAction
            type="button"
            variant="secondary"
            label={t.cancel}
            disabled={busy}
            onActivate={onClose}
          />
          {management && (
            <BrowserAction
              type="button"
              variant="primary"
              label={busy ? t.creating : t.create}
              busy={busy}
              disabled={!chosen}
              leadingIcon={<Plus aria-hidden="true" />}
              onActivate={() => void create()}
            />
          )}
        </>
      }
    >
      <form
        className="new-page"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <BrowserField
          controlId={`${ids}-title`}
          label={t.titleLabel}
          errorId={`${ids}-title-error`}
          error={titleError ? t.titleRequired : undefined}
          invalid={titleError}
          renderControl={(props) => (
            <input
              {...props}
              ref={titleRef}
              value={title}
              placeholder={t.titlePlaceholder}
              autoComplete="off"
              maxLength={512}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleError(false);
              }}
            />
          )}
        />
        {management && (
          <div className="new-page-templates" role="group" aria-labelledby={`${ids}-templates`}>
            <div className="new-page-templates-head">
              <span id={`${ids}-templates`} className="new-page-label">
                {t.templateLabel}
              </span>
              {onBrowse && (
                <button type="button" className="new-page-link" onClick={onBrowse}>
                  {t.browseAll}
                </button>
              )}
            </div>
            {listing === undefined ? (
              <p className="new-page-note" role="status">
                {t.loading}
              </p>
            ) : listing === 'failed' ? (
              <p className="new-page-note" role="alert">
                {t.loadFailed}{' '}
                <button
                  type="button"
                  className="new-page-link"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  {t.retry}
                </button>
              </p>
            ) : (
              <>
                {filtering && (
                  <div className="new-page-filter">
                    <input
                      type="search"
                      className="new-page-filter-field"
                      aria-label={t.filterPlaceholder}
                      placeholder={t.filterPlaceholder}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') move(event);
                        if (event.key === 'Enter') move(event);
                      }}
                    />
                    <div className="new-page-sources" role="radiogroup" aria-label={t.filterLabel}>
                      {(['all', 'builtIn', 'space'] as const).map((key) => (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={source === key}
                          className="new-page-source"
                          onClick={() => setSource(key)}
                        >
                          {key === 'all' ? t.all : key === 'builtIn' ? t.tmt : t.thisSpace}
                          <span className="new-page-source-count">{counts[key]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="new-page-scroll" data-scrolls={shown.length > 6 || undefined}>
                  <div
                    ref={listRef}
                    className="new-page-cards"
                    role="listbox"
                    tabIndex={0}
                    aria-labelledby={`${ids}-templates`}
                    aria-activedescendant={
                      chosen && shown.includes(chosen) ? optionId(chosen.name) : undefined
                    }
                    onKeyDown={move}
                  >
                    {shown.map((tpl) => (
                      <div
                        key={tpl.name}
                        id={optionId(tpl.name)}
                        role="option"
                        aria-selected={tpl.name === chosen?.name}
                        data-template={tpl.name}
                        className="new-page-card"
                        onClick={() => {
                          setPicked(tpl.name);
                          listRef.current?.focus();
                        }}
                      >
                        <span className="new-page-card-name">
                          <span>{tpl.name}</span>
                          <TemplateBadges template={tpl} />
                        </span>
                        <span className="new-page-card-meta">
                          {templateMeta(tpl, false)}
                          {tpl.source === 'space' && tpl.author ? ` · ${t.by(tpl.author)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                  {!shown.length && <p className="new-page-note">{t.none}</p>}
                </div>
              </>
            )}
          </div>
        )}
        {management && (
          <BrowserField
            controlId={`${ids}-creator`}
            label={t.creatorLabel}
            descriptionId={`${ids}-creator-note`}
            description={agents.state === 'failed' ? t.agentsUnavailable : undefined}
            renderControl={(props) => (
              <select
                {...props}
                value={creatorAgent ? creator : ''}
                disabled={agents.state !== 'ready'}
                onChange={(event) => setCreator(event.target.value)}
              >
                <option value="">{t.noAgent}</option>
                {agents.state === 'ready' &&
                  agents.agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} · {t.myMachine}
                    </option>
                  ))}
              </select>
            )}
          />
        )}
        {error && (
          <p className="new-page-error" role="alert">
            {error}
          </p>
        )}
        <BrowserDisclosure summary={t.terminal} divided open={management ? undefined : true}>
          <CopyCommand command={createCommand(title, chosen)} enabled />
        </BrowserDisclosure>
      </form>
    </BrowserDialog>
  );
}
