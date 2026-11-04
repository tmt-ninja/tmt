import {
  Button,
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
import { useRef, useState, type ReactNode } from 'react';
import { Listbox } from './components/listbox.js';
import { editFromSearch, PageListSearch, searchFromEdit } from './page-list-search.js';
import { authorCounts, filterPages, projectCounts } from './projects.js';
import { text } from './strings.js';
import type { PageSummary } from './transport.js';
import type { AttachRefusal } from './work-tree.js';

export type AddChoice =
  | { kind: 'attach'; pageId: string; title: string }
  | { kind: 'create'; title: string };

const t = text.workBand;
/** A new sub-page's title is at most 120 code points, inside the native page title bound. */
const TITLE_POINTS = 120;
/** The Create row's value; page IDs are UUIDs, so it never names a page. */
const CREATE = 'create';

function why(refusal: AttachRefusal): string {
  if (refusal.kind === 'self') return t.refusedSelf;
  if (refusal.kind === 'loop') return t.refusedLoop;
  return t.refusedAttached(refusal.parentTitle);
}

/**
 * The one Add window (#5820 Mock 5): search the owner list with the list's own search input and
 * matcher (#5868: `project:` and `by:` chips, free text) and attach a page, or create a page with
 * the typed free text when no page has exactly that title. A page that cannot be attached stays listed,
 * dimmed, with why. Enter picks the highlighted row; Esc closes. The owner's admission decides.
 */
export function AddSubpageDialog({
  title,
  pages,
  refusal,
  onChoose,
  onClose,
}: {
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
  const exact = candidates.some((page) => page.title.trim() === typed);
  // Create takes only the free text, never a token.
  const creatable = typed !== '' && !exact && [...typed].length <= TITLE_POINTS;
  const options = [
    ...(creatable ? [{ value: CREATE, label: t.create(typed), disabled: busy }] : []),
    ...candidates.map((page) => ({
      value: page.id,
      label: page.title,
      disabled: busy || refusal(page.id) !== undefined,
      group: { key: 'pages', label: t.pages },
    })),
  ];
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
            <DialogTitle>{t.addTitle(title)}</DialogTitle>
            <DialogDescription>{t.addDescription}</DialogDescription>
          </DialogHeader>
          <div className="work-add-command">
            <Listbox
              label={t.search}
              presentation="results"
              options={options}
              value=""
              onChange={(value) => {
                if (value === CREATE) choose({ kind: 'create', title: typed });
                else {
                  const page = candidates.find((candidate) => candidate.id === value);
                  if (page) choose({ kind: 'attach', pageId: page.id, title: page.title });
                }
              }}
              renderOption={({ value, label }) => {
                if (value === CREATE)
                  return (
                    <>
                      <Plus aria-hidden="true" />
                      <span className="work-add-title">{label}</span>
                    </>
                  );
                const refused = refusal(value);
                return (
                  <>
                    <FileText aria-hidden="true" />
                    <span className="work-add-title">{label}</span>
                    {refused && <span className="work-add-why">{why(refused)}</span>}
                  </>
                );
              }}
              inputTrigger={{
                open: options.length > 0,
                onOpenChange() {},
                render: (trigger) => (
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
                      resultTrigger={trigger}
                      // Arrows move through the results and Enter picks while focus stays here.
                      onUnhandledKeyDown={(event) => trigger.onKeyDown?.(event)}
                    />
                  </div>
                ),
              }}
            />
            {pages && candidates.length === 0 && <p className="work-add-note">{t.noMatch}</p>}
            {!pages && <p className="work-add-note">{t.pageListUnavailable}</p>}
          </div>
          {error && (
            <p className="work-add-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UiTheme>
  );
}
