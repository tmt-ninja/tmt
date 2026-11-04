import { text } from './strings.js';
import {
  BrowserAction,
  BrowserCountChip,
  BrowserDialog,
  BrowserField,
  BrowserIconAction,
} from '@tmt/browser-ui/react';
import { BrowserManageDialog, BrowserManageList } from '@tmt/browser-ui/manage-list';
import { Button } from '@tmt/browser-ui/ui';
import { ChevronLeft, Funnel, Plus } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { getTheme, subscribeTheme } from './theme.js';
import { listPages, type HomeSearch } from './page-list-filter.js';
import type { PageSummary } from './transport.js';
import { ShortcutStore } from './shortcut-store.js';
import {
  shortcutConditions,
  shortcutNameError,
  shortcutSearch,
  type Shortcut,
} from './shortcuts.js';
import './shortcut-dialogs.css';
const t = text.shortcuts;

export interface ShortcutDialogProps {
  mode: 'save' | 'edit' | 'manage';
  initial?: Shortcut;
  search: HomeSearch;
  store: ShortcutStore;
  items: readonly Shortcut[];
  pages: readonly PageSummary[];
  projects: readonly string[];
  error?: string;
  onClose(): void;
  focusFallback?(): HTMLElement | null;
  onSaved(item: Shortcut): void;
  onDeleted(id: string): void;
}
export function ShortcutDialog(props: ShortcutDialogProps) {
  const { mode, store, items, pages, projects, onClose, onSaved } = props;
  const [selected, setSelected] = useState(props.initial?.id);
  const [name, setName] = useState(props.initial?.name ?? '');
  const [search, setSearch] = useState(() =>
    shortcutSearch(props.mode === 'manage' ? (props.initial?.search ?? {}) : props.search),
  );
  const [error, setError] = useState<string>();
  const [view, setView] = useState<'list' | 'editor'>(mode === 'manage' ? 'list' : 'editor');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLElement>(null);
  const editorOpener = useRef<string>(t.create);
  const focusList = useRef(false);
  const backToList = () => {
    focusList.current = true;
    setView('list');
  };
  useLayoutEffect(() => {
    if (view !== 'list' || !focusList.current) return;
    focusList.current = false;
    const button = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (candidate) =>
        candidate.getAttribute('aria-label') === editorOpener.current ||
        candidate.textContent?.trim() === editorOpener.current,
    );
    button?.focus({ preventScroll: true });
  }, [view]);
  const manage = mode === 'manage';
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
  const title = manage ? t.manage : mode === 'edit' ? t.edit : t.saveAs;
  const failure = () => setError(t.saveFailed);
  const run = (action: () => void) => {
    try {
      action();
      setError(undefined);
      return true;
    } catch {
      failure();
      return false;
    }
  };
  const choose = (item?: Shortcut) => {
    setSelected(item?.id);
    setName(item?.name ?? '');
    setSearch(item?.search ?? {});
    setError(undefined);
  };
  const save = () =>
    run(() => {
      const invalid = shortcutNameError(name.trim());
      if (invalid) {
        setError(t.nameErrors[invalid]);
        return;
      }
      const item = store.save({ id: selected, name, search });
      if (manage) {
        choose(item);
        backToList();
      } else onSaved(item);
    });
  const filterError = (search.project?.length ?? 0) > 8 ? t.projectLimit : undefined;
  const matching = listPages(pages, search);
  const patch = (next: Partial<HomeSearch>) => setSearch((previous) => ({ ...previous, ...next }));
  const actions: ReactNode =
    manage && view === 'list' ? (
      <Button
        type="button"
        onClick={(event) => {
          if (event.isTrusted) onClose();
        }}
      >
        Done
      </Button>
    ) : (
      <>
        {selected && !manage && (
          <span className="shortcut-delete">
            <BrowserAction
              type="button"
              variant="ghost"
              label={text.pageList.remove}
              onActivate={(event) => {
                if (!event.isTrusted) return;
                run(() => {
                  store.delete(selected);
                  props.onDeleted(selected);
                  onClose();
                });
              }}
            />
          </span>
        )}
        <BrowserAction
          type="button"
          variant="secondary"
          label={text.pageList.cancel}
          onActivate={(event) => {
            if (!event.isTrusted) return;
            if (manage) backToList();
            else onClose();
          }}
        />
        <BrowserAction
          type="button"
          variant="primary"
          label={text.pageList.save}
          disabled={!!shortcutNameError(name.trim()) || !!filterError}
          onActivate={(event) => {
            if (event.isTrusted) save();
          }}
        />
      </>
    );
  const content = (
    <>
      <div className="shortcut-columns" data-manage={manage || undefined}>
        {manage && view === 'list' && (
          <nav ref={list} aria-label={t.savedList}>
            <BrowserManageList
              items={items.map((item) => ({
                id: item.id,
                label: item.name,
                detail: shortcutConditions(item.search).join(' · '),
              }))}
              onEdit={(id, origin) => {
                const item = items.find((candidate) => candidate.id === id);
                if (!item) return;
                editorOpener.current = origin === 'name' ? item.name : `Edit ${item.name}`;
                choose(item);
                setView('editor');
                requestAnimationFrame(() => input.current?.focus());
              }}
              onDelete={(id) =>
                run(() => {
                  store.delete(id);
                  props.onDeleted(id);
                })
              }
              emptyFocus={() =>
                [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
                  (button) => button.textContent?.trim() === t.create,
                ) ?? null
              }
              onMove={(id, direction) => run(() => store.move(id, direction))}
              onReorder={(id, before) => run(() => store.moveTo(id, before))}
            />
            {!items.length && <p>{t.empty}</p>}
            <BrowserAction
              type="button"
              variant="ghost"
              label={t.create}
              leadingIcon={<Plus />}
              onActivate={(event) => {
                if (!event.isTrusted) return;
                editorOpener.current = t.create;
                choose();
                setView('editor');
                requestAnimationFrame(() => input.current?.focus());
              }}
            />
          </nav>
        )}
        {view === 'editor' && (
          <div className="shortcut-editor">
            {manage && (
              <div className="shortcut-back">
                <BrowserIconAction
                  type="button"
                  variant="text"
                  label={t.backToList}
                  icon={<ChevronLeft />}
                  onActivate={(event) => {
                    if (event.isTrusted) backToList();
                  }}
                />
              </div>
            )}
            <BrowserField
              controlId={`${id}-name`}
              label={t.name}
              renderControl={(field) => (
                <input
                  {...field}
                  ref={input}
                  value={name}
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            />
            {mode !== 'save' && (
              <>
                <BrowserField
                  controlId={`${id}-projects`}
                  label={text.pageList.projects}
                  description={t.allProjects}
                  descriptionId={`${id}-projects-description`}
                  renderControl={(field) => (
                    <div {...field} role="group" className="shortcut-projects">
                      {[...new Set([...projects, ...(search.project ?? [])])].map((project) => (
                        <BrowserCountChip
                          key={project}
                          label={project}
                          pressed={search.project?.includes(project) ?? false}
                          tone={search.project?.includes(project) ? 'attention' : 'neutral'}
                          onActivate={() =>
                            patch({
                              project: search.project?.includes(project)
                                ? (search.project ?? []).filter((name) => name !== project)
                                : [...(search.project ?? []), project],
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                />
                <BrowserField
                  controlId={`${id}-state`}
                  label={t.pageState}
                  renderControl={(field) => (
                    <div {...field} role="group" className="shortcut-state">
                      {(['todo', 'in-progress', 'done'] as const).map((state) => {
                        const states = search.state
                          ? Array.isArray(search.state)
                            ? search.state
                            : [search.state]
                          : [];
                        const pressed = states.includes(state);
                        return (
                          <BrowserCountChip
                            key={state}
                            label={text.workBand.taskState[state]}
                            pressed={pressed}
                            tone={pressed ? 'attention' : 'neutral'}
                            onActivate={() => {
                              const next = pressed
                                ? states.filter((item) => item !== state)
                                : [...states, state];
                              patch({ state: next.length ? next : undefined });
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                />
                <div className="shortcut-also">
                  <div className="tmt-ui-field-label">{t.also}</div>
                  <div className="shortcut-chips">
                    <BrowserCountChip
                      label={t.needsMe}
                      pressed={!!search.needs}
                      tone={search.needs ? 'attention' : 'neutral'}
                      onActivate={() => patch({ needs: search.needs ? undefined : true })}
                    />
                    <BrowserCountChip
                      label={t.includeArchived}
                      pressed={!!search.includeArchived}
                      tone={search.includeArchived ? 'attention' : 'neutral'}
                      onActivate={() =>
                        patch({ includeArchived: search.includeArchived ? undefined : true })
                      }
                    />
                  </div>
                </div>
              </>
            )}
            {mode === 'save' && (
              <>
                <p className="shortcut-summary" role="status">
                  <Funnel aria-hidden size={16} />
                  <span>
                    {[...shortcutConditions(search), t.pageCount(matching.length)].join(' · ')}
                  </span>
                </p>
                <p className="shortcut-extra">{t.saveNote}</p>
              </>
            )}
            {mode !== 'save' && (
              <p
                className="shortcut-summary"
                role="status"
                title={t.matchesPreview(matching.map((page) => page.title))}
              >
                <Funnel aria-hidden size={16} />
                <span>{t.matchesPreview(matching.map((page) => page.title))}</span>
              </p>
            )}
          </div>
        )}
      </div>
      {filterError && <p role="alert">{filterError}</p>}
      {(error || props.error) && <p role="alert">{error ?? props.error}</p>}
    </>
  );
  const initialFocus = () =>
    view === 'editor' ? input.current : (list.current?.querySelector('button') ?? null);
  if (manage)
    return (
      <BrowserManageDialog
        title={title}
        theme={theme}
        description={
          view === 'list'
            ? 'Order sets the menu. Save new ones from the list with Save as shortcut.'
            : undefined
        }
        actions={actions}
        initialFocus={initialFocus}
        focusFallback={props.focusFallback}
        onClose={onClose}
      >
        {content}
      </BrowserManageDialog>
    );
  return (
    <BrowserDialog
      open
      title={title}
      size="regular"
      className="shortcut-dialog"
      data-mode={mode}
      initialFocus={initialFocus}
      focusFallback={props.focusFallback}
      onDismiss={onClose}
      actions={actions}
    >
      {content}
    </BrowserDialog>
  );
}
