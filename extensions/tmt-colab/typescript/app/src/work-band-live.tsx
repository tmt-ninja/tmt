import { browserUiClasses as ui } from '@tmt/browser-ui/static';
import { BrowserMenu } from '@tmt/browser-ui/react';
import { Popover, PopoverContent, PopoverTrigger, UiTheme } from '@tmt/browser-ui/ui';
import { MoreHorizontal } from 'lucide-react';
import { text } from './strings.js';
import { SaveNotApplied, SaveRefused, saveMessage, type MetadataAction } from './save.js';
import type { PageState } from './bootstrap.js';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import type { SearchEdit } from './page-list-search.js';
import { WorkBand, type WorkBandProps } from './work-band.js';
import { AddSubpageDialog, type AddChoice } from './work-add-dialog.js';
import type { PageBinding, PageTransport } from './transport.js';
import { rememberPages } from './quick-switcher-source.js';
import { useLinkedPages } from './work-stages.js';
import { subpageTree, type SubpageRow } from './work-tree.js';
import type { StoredWork } from './work.js';
import { relativeTime } from './display-time.js';
import { getTheme, subscribeTheme } from './theme.js';

const PAGE_STATES = ['todo', 'in-progress', 'done'] as const;
const t = text.workBand;

/** A refusal the serve explained, as opposed to an outcome nobody knows. */
const explained = (failure: unknown) =>
  failure instanceof SaveRefused || failure instanceof SaveNotApplied;

/** Run one owner write on another page: open its binding, write, give the connection up. */
export async function onPage<T>(
  transport: PageTransport,
  pageId: string,
  use: (binding: PageBinding, shown: PageState | null | undefined) => Promise<T>,
): Promise<T> {
  const snapshot = await transport.page(pageId);
  try {
    if (!snapshot.binding?.canWork?.()) throw new Error('This page cannot be changed here.');
    return await use(snapshot.binding, snapshot.pageState ?? snapshot.state);
  } finally {
    snapshot.binding?.close();
  }
}

/** Set a page's manual state through its expected-revision metadata route. */
async function writeState(binding: PageBinding, shown: PageState | null | undefined, next: string) {
  if (!binding.canMetadata?.() || !binding.metadata || !binding.metadataRevision)
    throw new Error('Page state cannot be changed here.');
  const revision = await binding.metadataRevision({ pageState: shown ?? 'todo' }, 'page-state');
  await binding.metadata('page.state' satisfies MetadataAction, { state: next }, revision);
}

/** The title-row work controls; without owner authority the state and tree are read-only. */
export function PageWorkBand({
  binding,
  transport,
  space,
  pageId,
  work,
  title,
  openPage,
  adding,
  onAddingChange,
  addDraft,
  workFacts,
  blockedReason,
  ...band
}: Omit<WorkBandProps, 'subpages' | 'childrenOf' | 'counts' | 'stateControl'> & {
  /** Absent for a page that never had work. */
  work?: StoredWork;
  title: string;
  /** Opens a sub-page in this app, as its title link does, without reloading. */
  openPage?(pageId: string): void;
  binding?: PageBinding;
  /** Where sub-page titles, states and deeper levels are read: the owner list this viewer
   * already has. */
  transport: PageTransport;
  space?: string;
  pageId: string;
  adding: boolean;
  onAddingChange(open: boolean): void;
  addDraft?: RefObject<SearchEdit | undefined>;
  workFacts?: import('./reading-details.js').WorkFactView;
  blockedReason?: string;
}): ReactNode {
  const { observed, pages } = useLinkedPages(transport, space, work);
  const tree = useMemo(() => subpageTree(pageId, work, pages), [pageId, work, pages]);
  const childStates = JSON.stringify(tree.top.map((row) => [row.id, row.state]));
  const previousChildStates = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!observed) return;
    const previous = previousChildStates.current;
    previousChildStates.current = childStates;
    if (previous !== undefined && previous !== childStates) binding?.refreshProgress?.();
  }, [binding, childStates, observed]);
  const reload = useCallback(async () => {
    try {
      rememberPages(transport, space, (await transport.spaceHome()).pages);
    } catch {
      // The list stays as it was; the next read of it shows the change.
    }
  }, [transport, space]);
  const owner = showsComputedStatus(binding);
  const stateControl = owner ? (
    <ComputedStatus
      facts={workFacts}
      blocked={blockedReason}
      change={
        transport.workFacts &&
        ((url, ignore) =>
          transport.workFacts!(pageId, new AbortController().signal, {
            exclusion: { url, ignore },
          }))
      }
    />
  ) : (
    <PageStateMenu binding={binding} state={band.pageState} />
  );
  const shared = {
    ...band,
    stateControl,
    subpages: tree.top,
    childrenOf: tree.childrenOf,
    counts: observed ? tree.counts : undefined,
  };
  if (!owner || !binding) return <WorkBand {...shared} />;
  const add = async (choice: AddChoice): Promise<string | undefined> => {
    try {
      // One action each: an attach that fails leaves nothing behind, and a create that made its
      // page before failing names it.
      if (choice.kind === 'create') await binding.work!('subpage.create', { title: choice.title });
      else await binding.work!('subpage.attach', { pageId: choice.pageId });
      void reload();
      return undefined;
    } catch (failure) {
      if (!explained(failure)) return t.attachUnknown;
      const made = (failure as SaveRefused | SaveNotApplied).childPage;
      if (made !== undefined) {
        void reload();
        return t.madeNotLinked(choice.title);
      }
      return saveMessage(failure);
    }
  };
  const detach = async (row: SubpageRow) => {
    const remove = (on: PageBinding) => on.work!('subpage.detach', { pageId: row.id });
    if (row.parent === pageId) await remove(binding);
    else await onPage(transport, row.parent, remove);
    void reload();
  };
  return (
    <>
      <WorkBand
        {...shared}
        onAdd={() => onAddingChange(true)}
        rowState={(row) => (
          <RowStateMenu
            row={row}
            write={async (next) => {
              await onPage(transport, row.id, (on, shown) => writeState(on, shown, next));
              await reload();
            }}
          />
        )}
        rowActions={(row) => (
          <RowMenu
            row={row}
            open={openPage ? () => openPage(row.id) : undefined}
            detach={() => detach(row)}
          />
        )}
      />
      {adding && (
        <AddSubpageDialog
          draft={addDraft}
          title={title}
          pages={pages}
          refusal={tree.refusal}
          onClose={() => onAddingChange(false)}
          onChoose={add}
        />
      )}
    </>
  );
}

/** Whether this viewer's page shows its computed status: only the owner, who can do work on it,
 * receives the work facts it is computed from. The page bar shows it under the same condition. */
export function showsComputedStatus(binding?: PageBinding): boolean {
  return binding?.work !== undefined && binding.canWork?.() === true;
}

/** A computed status's word, the same in the work band and the page bar. */
export function computedLabel(state: import('./reading-details.js').WorkFactView['state']) {
  return t.computedState[state];
}

/** The dot tone of a computed status, shared by the work band and the page bar. */
export function computedTone(state: string): 'blocked' | 'working' | 'waiting' | 'muted' {
  return state === 'blocked'
    ? 'blocked'
    : state === 'working'
      ? 'working'
      : ['needs-you', 'waiting-ci', 'waiting-release', 'possibly-stalled'].includes(state)
        ? 'waiting'
        : 'muted';
}

type ChangeBinding = (
  url: string,
  ignore: boolean,
) => Promise<import('./reading-details.js').WorkFactView>;

function ComputedStatus({
  change,
  facts,
  blocked,
}: {
  facts?: import('./reading-details.js').WorkFactView;
  change?: ChangeBinding;
  blocked?: string;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoredOnEscape = useRef(false);
  const state = facts?.state ?? 'unknown';
  const label = computedLabel(state);
  const tone = computedTone(state);
  return (
    <UiTheme theme={theme}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            ref={trigger}
            type="button"
            className={`work-page-state ${ui.countChip}`}
            aria-label={t.statusDetails(label)}
          >
            <span className={ui.stateMark} data-shape="dot" data-tone={tone} aria-hidden="true" />
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="work-status-details"
          onEscapeKeyDown={() => {
            const node = trigger.current;
            node?.focus({ preventScroll: true });
            restoredOnEscape.current = node !== null && node.ownerDocument.activeElement === node;
          }}
          onCloseAutoFocus={(event) => {
            if (restoredOnEscape.current) event.preventDefault();
            restoredOnEscape.current = false;
          }}
        >
          <StatusDetailsBody state={state} facts={facts} blocked={blocked} change={change} />
        </PopoverContent>
      </Popover>
    </UiTheme>
  );
}

function RowMenu({
  row,
  open,
  detach,
}: {
  row: SubpageRow;
  open?(): void;
  detach(): Promise<void>;
}) {
  const [error, setError] = useState<string>();
  return (
    <>
      <BrowserMenu
        label={t.more(row.title ?? t.unknownPage)}
        icon={<MoreHorizontal aria-hidden="true" />}
        items={[
          ...(open ? [{ key: 'open', label: t.open }] : []),
          { key: 'detach', label: t.detach },
        ]}
        onSelect={(key) => {
          if (key === 'open') open?.();
          if (key === 'detach')
            detach().then(
              () => setError(undefined),
              (failure: unknown) => setError(saveMessage(failure)),
            );
        }}
      />
      {error && <span role="alert">{error}</span>}
    </>
  );
}

function RowStateMenu({ row, write }: { row: SubpageRow; write(next: string): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const label = row.state ? t.taskState[row.state] : t.unknown;
  return (
    <div className="work-state-control">
      <BrowserMenu
        label={t.rowState(row.title ?? t.unknownPage)}
        variant="count"
        valueLabel={label}
        disabled={busy}
        items={PAGE_STATES.map((value) => ({
          key: value,
          label: t.taskState[value],
          role: 'menuitemradio' as const,
          checked: value === row.state,
        }))}
        onSelect={(next) => {
          if (busy || next === row.state) return;
          setBusy(true);
          setError(undefined);
          write(next).then(
            () => setBusy(false),
            (failure: unknown) => {
              setBusy(false);
              setError(saveMessage(failure));
            },
          );
        }}
      />
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

/** The verified label moves only when the owner's admitted stream publishes the commit. */
export function PageStateMenu({
  binding,
  state,
}: {
  binding?: PageBinding;
  state?: PageState | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const revision = useRef<Promise<string | undefined>>(undefined);
  const label = state ? t.taskState[state] : t.stateUnavailable;
  if (!binding?.canMetadata?.() || !binding.metadata || !binding.metadataRevision || state == null)
    return <span className={`work-page-state ${ui.countChip}`}>{label}</span>;
  const select = async (next: string) => {
    if (busy || !(PAGE_STATES as readonly string[]).includes(next)) return;
    setBusy(true);
    setError(undefined);
    try {
      const frozen = await revision.current;
      if (frozen === undefined) return;
      await binding.metadata!('page.state', { state: next }, frozen);
    } catch (failure) {
      setError(failure instanceof SaveRefused ? failure.message : saveMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="work-state-control">
      <BrowserMenu
        label={t.pageState}
        variant="count"
        valueLabel={label}
        disabled={busy}
        onOpenChange={(open) => {
          if (!open) return;
          setError(undefined);
          revision.current = binding.metadataRevision!({ pageState: state }, 'page-state').catch(
            (failure) => {
              setError(failure instanceof Error ? failure.message : saveMessage(failure));
              return undefined;
            },
          );
        }}
        items={PAGE_STATES.map((value) => ({
          key: value,
          label: t.taskState[value],
          role: 'menuitemradio' as const,
          checked: value === state,
        }))}
        onSelect={(key) => {
          void select(key);
        }}
      />
      {busy && <span role="status">{t.savingState}</span>}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

/** The status popover's body (#6474): one reason sentence, the owner's activity and each PR's
 * facts. The page's status chip and a Work home row show the same details. */
export function StatusDetailsBody({
  state: originalState,
  facts: originalFacts,
  change,
  blocked,
}: {
  state: import('./reading-details.js').WorkFactView['state'];
  facts?: import('./reading-details.js').WorkFactView;
  change?: ChangeBinding;
  blocked?: string;
}) {
  const [updated, setUpdated] = useState<{
    base: typeof originalFacts;
    view: NonNullable<typeof originalFacts>;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const facts = updated && updated.base === originalFacts ? updated.view : originalFacts;
  const state = facts?.state ?? originalState;
  async function setIgnored(url: string, ignore: boolean) {
    if (!change || busy) return;
    setBusy(true);
    setError(false);
    try {
      setUpdated({ base: originalFacts, view: await change(url, ignore) });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const label = t.computedState[state];
  // The PR that decides the status: an open one, or a merged one not yet in a release.
  const prNumber = (wanted: 'open' | 'merged') =>
    facts?.pulls
      .find(({ fact }) => fact?.state === wanted && (wanted === 'open' || fact.released === false))
      ?.url.split('/')
      .at(-1);
  const reason =
    // A blocked item's own reason is the sentence under the heading, never prefixed again.
    state === 'blocked'
      ? (blocked ?? t.statusReason.blocked(undefined))
      : state === 'waiting-ci'
        ? t.statusReason['waiting-ci'](prNumber('open'))
        : state === 'waiting-release'
          ? t.statusReason['waiting-release'](prNumber('merged'))
          : t.statusReason[state];
  return (
    <>
      <strong>{label}</strong>
      <p>{reason}</p>
      {facts?.activity && (
        <p>
          {t.activityState[facts.activity.state]} ·{' '}
          {t.factAge(relativeTime(facts.activity.observedAtMs, facts.asOfMs))}
        </p>
      )}
      {facts?.titleDiscovery && facts.titleDiscovery.state !== 'complete' && (
        <small>{t.titleDiscovery[facts.titleDiscovery.state]}</small>
      )}
      {facts?.pulls.map(({ url, fact }, index) => (
        <p key={url}>
          PR #{url.split('/').at(-1)} ·{' '}
          {fact?.tag ? t.releasedIn(fact.tag) : fact ? t.pullState[fact.state] : t.unknown}
          {facts.titleDiscovery && index >= facts.titleDiscovery.explicitCount && (
            <> · {t.titleMatch(facts.titleDiscovery.number)}</>
          )}
          {change && facts.titleDiscovery && index >= facts.titleDiscovery.explicitCount && (
            <button disabled={busy} onClick={() => void setIgnored(url, true)}>
              {t.ignoreMatch}
            </button>
          )}
          {fact?.checks && <> · {t.checks[fact.checks]}</>}
          {fact?.state === 'open' && !fact.checks && <> · {t.checksUnavailable}</>}
          {fact && <> · {t.factAge(relativeTime(fact.observedAtMs, facts.asOfMs))}</>}
        </p>
      ))}
      {facts?.titleDiscovery?.ignored.map((url) => (
        <p key={url}>
          PR #{url.split('/').at(-1)} · {t.ignoredMatch}{' '}
          {change && (
            <button disabled={busy} onClick={() => void setIgnored(url, false)}>
              {t.restoreMatch}
            </button>
          )}
        </p>
      ))}
      {error && <p role="alert">{t.bindingFailed}</p>}
      {!facts && <p>{t.statusUnavailable}</p>}
    </>
  );
}
