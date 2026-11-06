import {
  Button,
  Command,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  UiTheme,
} from '@tmt/browser-ui/ui';
import '@tmt/browser-ui/ui.css';
import { FileText, Plus, Search } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { editFromSearch, PageListSearch, searchFromEdit } from './page-list-search.js';
import { authorCounts, filterPages, projectCounts } from './projects.js';
import { text } from './strings.js';
import type { PageSummary } from './transport.js';
import { pageLocation, type AttachRefusal } from './work-tree.js';

export type AddChoice =
  | { kind: 'attach'; pageId: string; title: string }
  | { kind: 'create'; title: string };

const t = text.workBand;
/** A new sub-page's title is at most 120 code points, inside the native page title bound. */
const TITLE_POINTS = 120;
/** The Create row's value; page IDs are UUIDs, so it never names a page. */
const CREATE = 'create';

/**
 * The one Add window (#5820 Mock 5): search the owner list with the list's own search input and
 * matcher (#5868: `project:` and `by:` chips, free text) and attach a page, or create a page with
 * the typed free text when no page has exactly that title. Refused pages are omitted. Enter picks
 * the highlighted row; Esc closes. The owner's admission decides again when a choice is written.
 */
export function AddSubpageDialog({
  title,
  pages,
  refusal,
  onChoose,
  onClose,
  mode = 'child',
  nowUnder,
}: {
  mode?: 'child' | 'parent';
  nowUnder?: string;
  /** This page's title. */
  title: string;
  pages?: readonly PageSummary[];
  refusal(pageId: string): AttachRefusal | undefined;
  /** Resolves undefined once attached, or the sentence to show. */
  onChoose(choice: AddChoice): Promise<string | undefined>;
  onClose(): void;
}): ReactNode {
  // The list's own search draft: `project:` and `by:` tokens and free text (#5868).
  const [edit, setEdit] = useState(() => editFromSearch([], ''));
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState('');
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const resultTriggerRef = useCallback(() => {}, []);
  const [listId, setListId] = useState('');
  const [activeId, setActiveId] = useState<string>();
  const [error, setError] = useState<string>();
  const content = useRef<HTMLDivElement>(null);
  const filter = searchFromEdit(edit);
  const typed = filter.q;
  const offered = (pages ?? []).filter((page) => !page.archived && page.pageType !== 'shell');
  // The list's matcher, so a token or a word narrows the same pages here as on the list.
  const candidates = filterPages(
    offered,
    { projects: filter.projects, authors: filter.authors, text: typed },
    'updated',
  );
  const eligible = candidates.filter((page) => !refusal(page.id));
  const exact = candidates.some((page) => page.title.trim() === typed);
  // Create takes only the free text, never a token.
  const creatable = mode === 'child' && typed !== '' && !exact && [...typed].length <= TITLE_POINTS;
  const values = [...(creatable ? [CREATE] : []), ...eligible.map((page) => page.id)];
  const current = values.includes(active) ? active : (values[0] ?? '');
  useLayoutEffect(() => {
    const node = list;
    if (!node) return;
    const sync = () => {
      setListId(node.id);
      setActiveId(node.querySelector<HTMLElement>('[data-selected="true"]')?.id);
    };
    const observer = new MutationObserver(sync);
    observer.observe(node, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['id', 'data-selected'],
    });
    sync();
    return () => observer.disconnect();
  }, [list]);
  const choose = (choice: AddChoice) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    void onChoose(choice).then((failure) => {
      setBusy(false);
      if (failure === undefined) onClose();
      else setError(failure);
    });
  };
  return (
    <UiTheme>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <DialogContent
          ref={content}
          className="work-add-dialog"
          initialFocus={() =>
            content.current?.querySelector<HTMLElement>('[role="combobox"]') ?? null
          }
        >
          <DialogHeader>
            <DialogTitle>{mode === 'parent' ? t.moveTitle(title) : t.addTitle(title)}</DialogTitle>
            <DialogDescription className={mode === 'parent' ? 'tmt:sr-only' : undefined}>
              {mode === 'parent' ? t.moveDescription : t.addDescription}
            </DialogDescription>
            {mode === 'parent' && nowUnder && (
              <p className="work-add-current">{t.nowUnder(nowUnder)}</p>
            )}
          </DialogHeader>
          <div className="work-add-command">
            <Command shouldFilter={false} value={current} onValueChange={setActive}>
              <div className="work-add-search">
                <Search className="work-add-search-mark" aria-hidden="true" />
                <PageListSearch
                  edit={edit}
                  onChange={(next) => {
                    setEdit(next);
                    setError(undefined);
                  }}
                  resetKey={0}
                  projects={projectCounts(offered)}
                  authors={authorCounts(offered)}
                  onApply={() => {}}
                  onClear={() => {
                    if (!busy) onClose();
                  }}
                  placeholder={t.search}
                  label={t.search}
                  resultTrigger={{
                    ref: resultTriggerRef,
                    'aria-expanded': values.length > 0,
                    'aria-controls': listId || undefined,
                    'aria-activedescendant': activeId,
                  }}
                  onUnhandledKeyDown={(event) => {
                    if (
                      !event.isTrusted ||
                      event.nativeEvent.isComposing ||
                      (event.repeat && event.key === 'Enter') ||
                      event.altKey ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.shiftKey
                    )
                      return;
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!values.length) return;
                      const step = event.key === 'ArrowDown' ? 1 : -1;
                      setActive(
                        values[
                          (Math.max(0, values.indexOf(current)) + step + values.length) %
                            values.length
                        ] ?? '',
                      );
                    } else if ((event.key === 'Home' || event.key === 'End') && values.length) {
                      event.preventDefault();
                      event.stopPropagation();
                      setActive(event.key === 'Home' ? values[0] : values[values.length - 1]);
                    } else if (event.key === 'Enter' && current) {
                      event.preventDefault();
                      event.stopPropagation();
                      if (current === CREATE) choose({ kind: 'create', title: typed });
                      else {
                        const page = eligible.find((item) => item.id === current);
                        if (page) choose({ kind: 'attach', pageId: page.id, title: page.title });
                      }
                    }
                  }}
                />
              </div>
              <CommandList ref={setList}>
                {creatable && (
                  <CommandItem
                    value={CREATE}
                    variant="page"
                    disabled={busy}
                    leading={<Plus aria-hidden="true" />}
                    onSelect={() => {}}
                    onPointerDown={(event) => event.preventDefault()}
                    onClickCapture={(event) => {
                      if (event.isTrusted) choose({ kind: 'create', title: typed });
                    }}
                  >
                    {t.create(typed)}
                  </CommandItem>
                )}
                {eligible.map((page) => (
                  <CommandItem
                    key={page.id}
                    value={page.id}
                    variant="page"
                    disabled={busy}
                    leading={<FileText aria-hidden="true" />}
                    meta={pageLocation(page, offered)}
                    onSelect={() => {}}
                    onPointerDown={(event) => event.preventDefault()}
                    onClickCapture={(event) => {
                      if (event.isTrusted)
                        choose({ kind: 'attach', pageId: page.id, title: page.title });
                    }}
                  >
                    {page.title}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
            {pages && eligible.length === 0 && <p className="work-add-note">{t.noMatch}</p>}
            {!pages && <p className="work-add-note">{t.pageListUnavailable}</p>}
          </div>
          {error && (
            <p className="work-add-error" role="alert">
              {error}
            </p>
          )}
          {mode === 'child' && (
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {t.cancel}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </UiTheme>
  );
}
