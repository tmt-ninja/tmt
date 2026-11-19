import { useSyncExternalStore, type MouseEvent, type ReactNode, useState } from 'react';
import { browserUiClasses as ui } from '@tmt/browser-ui/static';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  UiTheme,
} from '@tmt/browser-ui/ui';
import { useMedia } from './use-media.js';
import { getTheme, subscribeTheme } from './theme.js';
import type { WorkFactView } from './reading-details.js';
import { text } from './strings.js';
import { computedLabel, computedTone } from './work-band-live.js';
import { projectTone } from './projects.js';
import './page-projects.css';
import './page-bar-summary.css';

/** The labels the bar names before a count; the page header's picker names them all. */
const LABELS = 3;

/**
 * The opened page's summary in the top bar, after its number and title (#6611): its computed status,
 * in the list's and Work home's words, and its projects as labels. It stays in view while the page
 * scrolls. Since #6652 it is also where they are opened: the status chip shows the page's details and
 * the labels open the project picker. A narrow bar drops the labels first, then keeps only the dot.
 */
export function PageBarSummary({
  facts,
  status,
  labels,
  details,
  onLabels,
  subpages,
}: {
  facts?: WorkFactView;
  /** What the status chip opens (#6652): a popover, or on a phone a sheet that also lists the
   * page's projects (`sheet` true). `close` shuts it, for a control inside that opens a window. */
  details?(sheet: boolean, close: () => void): ReactNode;
  /** A viewer's sub-pages where the owner has the status chip (#6652): the band's own toggle. */
  subpages?: ReactNode;
  /** Opens the page's project picker under the bar's labels (#6652). */
  onLabels?(from: DOMRect): void;
  /** Whether the page shows its computed status (`showsComputedStatus`): no chip otherwise. */
  status: boolean;
  labels: readonly string[];
}) {
  const state = facts?.state ?? 'unknown';
  // The same word as the page's own status chip just under the bar.
  const label = computedLabel(state);
  const shown = labels.slice(0, LABELS);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
  // The bar keeps only its status dot up to 900px (its labels leave first): the details open as a
  // sheet there, with the projects the bar no longer shows.
  const sheet = useMedia('(max-width: 900px)');
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  // Escape in a menu inside the details (a sub-page's row or state menu) closes only that menu.
  // The details hear the key first and their layer would claim it, so they close the menu's
  // dialog themselves, which the menu treats as its own close.
  const keepForMenu = (event: KeyboardEvent) => {
    const menu = event.target instanceof Element ? event.target.closest('[role="menu"]') : null;
    if (!menu) return;
    event.preventDefault();
    menu.closest('dialog')?.close();
  };
  const viewerSubpages = !status && !sheet ? subpages : undefined;
  if (!status && !viewerSubpages && shown.length === 0) return null;
  const chip = (
    <>
      <span
        className={ui.stateMark}
        data-shape="dot"
        data-tone={computedTone(state)}
        aria-hidden="true"
      />
      <span className="page-bar-status-label">{label}</span>
    </>
  );
  const trigger = (
    <button
      type="button"
      className={`page-bar-status ${ui.countChip}`}
      title={label}
      data-state={state}
      aria-label={text.workBand.statusDetails(label)}
    >
      {chip}
    </button>
  );
  const Labels = onLabels ? 'button' : 'span';
  return (
    <span className="page-bar-summary">
      {viewerSubpages && <span className="page-bar-subpages">{viewerSubpages}</span>}
      {status &&
        (details ? (
          <UiTheme theme={theme}>
            {sheet ? (
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>{trigger}</SheetTrigger>
                <SheetContent
                  side="bottom"
                  className="page-bar-sheet"
                  onEscapeKeyDown={keepForMenu}
                >
                  <SheetTitle className="tmt-ui-visually-hidden">{text.pageBar.details}</SheetTitle>
                  {details(true, close)}
                </SheetContent>
              </Sheet>
            ) : (
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="page-bar-details"
                  onEscapeKeyDown={keepForMenu}
                >
                  {details(false, close)}
                </PopoverContent>
              </Popover>
            )}
          </UiTheme>
        ) : (
          <span className={`page-bar-status ${ui.countChip}`} title={label} data-state={state}>
            {chip}
          </span>
        ))}
      {shown.length > 0 && (
        <Labels
          className="page-bar-labels"
          title={labels.join(', ')}
          {...(onLabels
            ? {
                type: 'button' as const,
                'aria-label': text.pageBar.editLabels(labels.join(', ')),
                onClick: (event: MouseEvent<HTMLElement>) =>
                  onLabels(event.currentTarget.getBoundingClientRect()),
              }
            : {})}
        >
          {/* The same chips as the page's own projects, in the same tones. */}
          {shown.map((name) => (
            <span key={name} className="page-bar-label" data-project-tone={projectTone(name)}>
              <span>{name}</span>
            </span>
          ))}
          {labels.length > shown.length && (
            <span
              className="page-bar-label"
              data-overflow=""
              aria-label={text.pageBar.moreLabels(labels.length - shown.length)}
            >
              +{labels.length - shown.length}
            </span>
          )}
        </Labels>
      )}
    </span>
  );
}
