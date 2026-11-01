import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowUpDown,
  Bookmark,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListFilter,
  MessageCircle,
  MessagesSquare,
  MousePointer2,
  Pin,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { BrowserNotifications, BusyMark, type BrowserNotification } from '../src/react.js';
import { RichInput, emptyRichInputValue, type RichInputValue } from '../src/rich-input/index.js';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FloatingAction,
  FloatingActions,
  FloatingDock,
  FloatingWindow,
  FloatingWindowAction,
  Skeleton,
  Surface,
  Tabs,
  TabsBar,
  TabsList,
  TabsTrigger,
  TooltipProvider,
  UiTheme,
} from '../src/ui/index.js';
import { PageRow } from './patterns.js';

/**
 * The composed patterns (#5821 C): each is real components only, and its page shows it in an
 * iframe at the wide width and at 390, in light and dark, so a pattern is reviewed at the widths
 * it ships at. A frame is `?frame=pattern&slug=<slug>&state=<state>&theme=<theme>`.
 */
interface PatternDoc {
  slug: string;
  title: string;
  lead: string;
  /** The states the page shows, each in all four viewports. */
  states: [string, string][];
  height: number;
  rules: string[];
  Body(props: { state: string }): ReactNode;
}

const stages = [
  ['all', 'All', 38],
  ['needs', 'Needs you', 4],
  ['discussion', 'Discussion', 12],
  ['progress', 'In progress', 9],
  ['done', 'Done', 13],
  ['archived', 'Archived', 6],
] as const;

function StageTabs() {
  return (
    <Tabs defaultValue="all">
      <TabsBar
        actions={
          <>
            <Button type="button" variant="outline" collapseLabel="Save as shortcut">
              <Bookmark aria-hidden="true" />
            </Button>
            <Button type="button" collapseLabel="New page">
              <Plus aria-hidden="true" />
            </Button>
          </>
        }
      >
        <TabsList variant="line">
          {stages.map(([value, label, count]) => (
            <TabsTrigger key={value} value={value}>
              {label} <span className="pattern-count">{count}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </TabsBar>
    </Tabs>
  );
}

function ListControls() {
  const [search, setSearch] = useState<RichInputValue>(emptyRichInputValue);
  return (
    <div className="pattern-stack">
      <div className="pattern-cards">
        {['Theme B review', 'Release plan', 'Remote pairing walkthrough'].map((title) => (
          <Surface key={title} level="sheet" className="pattern-card">
            <FileText aria-hidden="true" />
            <b>{title}</b>
            <Pin aria-label="Pinned" className="pattern-pin" />
          </Surface>
        ))}
      </div>
      <StageTabs />
      <div className="pattern-search">
        <RichInput
          shape="single"
          label="Search pages"
          placeholder="Search pages, or type project:"
          value={search}
          onChange={setSearch}
          leading={<Search aria-hidden="true" />}
          suggestions={[
            {
              kind: 'project',
              trigger: 'project:',
              options: (query) =>
                ['design', 'spec', 'release-0.9']
                  .filter((name) => name.startsWith(query))
                  .map((name) => ({ text: `project:${name}` })),
            },
          ]}
        />
        <Button type="button" variant="outline" collapseLabel="Filter">
          <ListFilter aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" collapseLabel="Sort">
          <ArrowUpDown aria-hidden="true" />
        </Button>
      </div>
      <div>
        <PageRow title="Theme B review" tags={['design', 'spec']} updated="2 min ago" unread />
        <PageRow title="Release plan" tags={['release-0.9']} updated="18 min ago" />
        <PageRow
          title="Night execution plan"
          tags={['night-shift']}
          updated="40 min ago"
          state="waiting"
        />
      </div>
    </div>
  );
}

function FabWindow({ state }: { state: string }) {
  const [open, setOpen] = useState<'chat' | 'comments' | null>(
    state === 'closed' ? null : 'comments',
  );
  const resolved = state === 'resolved';
  return (
    <TooltipProvider>
      <div className="pattern-topbar">Release plan / Theme B review</div>
      <p className="pattern-page">The page column sits here; the dock floats at the bottom end.</p>
      <FloatingDock top={56}>
        {open && (
          <FloatingWindow
            key={open}
            open
            label={open === 'chat' ? 'Chat' : 'Discussion'}
            onClose={() => setOpen(null)}
            header={
              open === 'comments' ? (
                <>
                  <span className="pattern-counter">{resolved ? '3 / 3' : '1 / 2'}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="xs">
                        {resolved ? 'All' : 'Open'} <ChevronDown aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem>Open</DropdownMenuItem>
                      <DropdownMenuItem>Needs you</DropdownMenuItem>
                      <DropdownMenuItem>All</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="pattern-grow" />
                  <FloatingWindowAction
                    label="Previous"
                    icon={<ChevronLeft />}
                    disabled={!resolved}
                  />
                  <FloatingWindowAction label="Next" icon={<ChevronRight />} disabled={resolved} />
                  <FloatingWindowAction
                    label={resolved ? 'Reopen' : 'Resolve'}
                    icon={resolved ? <RotateCcw /> : <Check />}
                  />
                  <FloatingWindowAction label="Resolve all open (2)" icon={<CheckCheck />} />
                </>
              ) : undefined
            }
          >
            <p className="pattern-quote">
              “
              {resolved
                ? 'Disabled is neutral grey on every variant'
                : 'Corners are small: 2px on controls, 4px on surfaces.'}
              ”
            </p>
            {resolved ? (
              <Badge variant="secondary">Resolved</Badge>
            ) : (
              <>
                <p>
                  <b>sample-lead</b> Agree on 2/4. Counts keep the same radius.
                </p>
                <p>
                  <b>sample-1</b> Try 4/6 once on the gallery before we lock it.
                </p>
              </>
            )}
          </FloatingWindow>
        )}
        <FloatingActions label="Page actions">
          <FloatingAction label="Select to comment" icon={<MousePointer2 />} />
          <FloatingAction
            label="Chat"
            icon={<MessageCircle />}
            expanded={open === 'chat'}
            onClick={() => setOpen(open === 'chat' ? null : 'chat')}
          />
          <FloatingAction
            label="Comments (2)"
            icon={<MessagesSquare />}
            count={2}
            expanded={open === 'comments'}
            onClick={() => setOpen(open === 'comments' ? null : 'comments')}
          />
        </FloatingActions>
      </FloatingDock>
    </TooltipProvider>
  );
}

function AddDialog() {
  return (
    <Dialog open>
      <DialogContent
        className="pattern-add-dialog"
        showCloseButton
        initialFocus={() => document.querySelector<HTMLElement>('.pattern-add-command input')}
      >
        <DialogHeader>
          <DialogTitle>Add a sub-page to “Theme B review”</DialogTitle>
          <DialogDescription>
            Search a page to attach, or create one with this name.
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="pattern-add-command">
          <CommandInput placeholder="Search pages" defaultValue="remote" />
          <CommandList>
            <CommandGroup>
              <CommandItem>
                <Plus aria-hidden="true" /> Create “remote” as a new sub-page
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Pages">
              {Array.from({ length: 14 }, (_, index) => (
                <CommandItem key={index}>Remote page {index + 1}</CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function NeedsYou({ state }: { state: string }) {
  const [confirm, setConfirm] = useState(state === 'confirm');
  const items = [
    ['Answer', 'Which radius ships with B?', 'sample-lead'],
    ['Review', 'Release plan', 'sample-1'],
    ['Reading', 'Night execution plan', 'sample-2'],
    ['Proposal', 'Archive the old palette', 'sample-lead'],
  ];
  return (
    <div className="pattern-needs">
      <DropdownMenu defaultOpen={state === 'menu'} modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost">
            <span className="pattern-dot" aria-hidden="true" /> Needs you{' '}
            <span className="pattern-count">4</span> <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="pattern-needs-menu">
          <DropdownMenuLabel>4 waiting on you</DropdownMenuLabel>
          {items.map(([kind, title, who]) => (
            <DropdownMenuItem key={title}>
              <span className="pattern-dot" aria-hidden="true" />
              <span className="pattern-needs-item">
                <b>{title}</b>
                <span className="pattern-muted">
                  {kind} · {who}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirm(true)}>Clear all</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Clear 4 items from Needs you?</DialogTitle>
            <DialogDescription>
              They leave your list only. Nothing is answered, accepted or closed; a changed item
              comes back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => setConfirm(false)}>
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkBand({ state }: { state: string }) {
  const [open, setOpen] = useState(state === 'expanded');
  const pages = [
    ['Remote v2 rollout', 'In progress', 3, 5],
    ['Remote admin prototype', 'Done', 4, 4],
    ['Remote data plan', 'Needs you', 1, 3],
  ] as const;
  return (
    <Surface level="sheet" className="pattern-band">
      <button
        type="button"
        className="pattern-band-bar"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Badge variant="outline">In progress</Badge>
        <span className="pattern-meter" aria-label="3 of 5 done">
          <span style={{ width: '60%' }} />
        </span>
        <span className="pattern-muted">3 of 5 done · 3 sub-pages</span>
        <ChevronDown aria-hidden="true" data-open={open || undefined} className="pattern-chevron" />
      </button>
      {open && (
        <ul className="pattern-band-pages">
          {pages.map(([title, stage, done, total]) => (
            <li key={title}>
              <FileText aria-hidden="true" />
              <span>{title}</span>
              <span className="pattern-muted">{stage}</span>
              <span className="pattern-muted">
                {done}/{total}
              </span>
            </li>
          ))}
          <li>
            <Button type="button" variant="ghost" size="sm">
              <Plus aria-hidden="true" /> Add a sub-page
            </Button>
          </li>
        </ul>
      )}
    </Surface>
  );
}

function SendingRows() {
  return (
    <div className="pattern-turns">
      <div className="pattern-turn">
        <b>You</b>
        <p>Ship B as the default once the Colab pages are swept.</p>
        <span className="pattern-muted">Delivered to @sample-lead · 10:15</span>
      </div>
      <div className="pattern-turn" data-state="sending">
        <b>You</b>
        <p>And the TUI docs go in with it.</p>
        <span className="pattern-muted pattern-inline">
          <BusyMark /> Sending to @sample-lead…
        </span>
      </div>
      <div className="pattern-turn" data-state="failed">
        <b>You</b>
        <p>Can you check the 390 captures?</p>
        <span className="pattern-failed">
          ✕ Not sent: the agent is offline.{' '}
          <Button type="button" variant="link" size="xs">
            Retry
          </Button>
        </span>
      </div>
      <div className="pattern-turn" data-state="unsent">
        <b>Draft</b>
        <p>Also the Needs you menu…</p>
        <span className="pattern-muted">
          Unsent, kept on this device ·{' '}
          <Button type="button" variant="link" size="xs">
            Edit
          </Button>
        </span>
      </div>
    </div>
  );
}

function LoadingError({ state }: { state: string }) {
  if (state === 'error')
    return (
      <Alert variant="destructive">
        <AlertTitle>Pages did not load</AlertTitle>
        <AlertDescription>
          The connection dropped before the list arrived. What you had stays on screen.
          <Button type="button" variant="outline" size="sm" className="pattern-retry">
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  return (
    <div className="pattern-stack" aria-busy="true" aria-label="Loading pages">
      {[60, 45, 70, 52].map((width) => (
        <div key={width} className="pattern-skeleton-row">
          <Skeleton className="pattern-skeleton-title" style={{ width: `${width}%` }} />
          <Skeleton className="pattern-skeleton-meta" />
        </div>
      ))}
    </div>
  );
}

function ConfirmNotify({ state }: { state: string }) {
  const events = useMemo<BrowserNotification[]>(
    () => [
      {
        id: 'n1',
        destination: 'Chat',
        firstLine: 'sample-lead replied in Chat',
        quote: 'B looks right on the list page.',
        onActivate: () => {},
      },
      {
        id: 'n2',
        destination: 'Thread',
        firstLine: 'sample-1 answered your thread',
        onActivate: () => {},
      },
    ],
    [],
  );
  return state === 'confirm' ? (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete “Weekly plan, week 44”?</DialogTitle>
          <DialogDescription>
            This removes the page for everyone. Copies already made cannot be taken back.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" autoFocus>
            Cancel
          </Button>
          <Button type="button" variant="destructive">
            Delete page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : (
    <BrowserNotifications
      pageKey="pattern"
      events={events}
      suspended={false}
      isEligible={() => true}
    />
  );
}

export const morePatterns: PatternDoc[] = [
  {
    slug: 'tabs-row',
    title: 'Tabs row with actions',
    lead: 'The stage tabs and the page’s actions share one row: tabs left, actions right, space-l apart. Under 760px the tabs scroll with an edge fade and the actions turn into equal squares.',
    states: [['default', 'Default']],
    height: 120,
    rules: [
      'Nothing sits above the tabs except pinned cards.',
      'The actions keep their order: Save as shortcut, then New page.',
      'The selected tab stays in view when the row scrolls.',
    ],
    Body: () => <StageTabs />,
  },
  {
    slug: 'list-controls',
    title: 'List controls',
    lead: 'Top to bottom: pinned cards, the tabs row with actions, the search row, then the list. The search takes the row; Filter and Sort sit after it, bordered, at control-size-l, and turn square under 760px.',
    states: [['default', 'Default']],
    height: 560,
    rules: [
      'Search is the chip input: typing project: offers projects as chips.',
      'Filter and Sort never move above the tabs.',
    ],
    Body: () => <ListControls />,
  },
  {
    slug: 'fab-window',
    title: 'Floating actions and window',
    lead: 'A floating action opens one window above the dock. The thread window starts with its counter, then the filter, Previous and Next, Resolve, Resolve all and Close. There is no list view and no title: the window is named Discussion for assistive technology.',
    states: [
      ['closed', 'Closed'],
      ['thread', 'One thread'],
      ['resolved', 'Resolved thread'],
    ],
    height: 520,
    rules: [
      'The action that opened the window reads pressed while it is open.',
      'Esc or Close returns focus to that action; an open menu takes the first Esc.',
      'The window ends where its content ends, up to the space between the top bar and the dock.',
      'Every header control, hover fill included, sits inside the window.',
    ],
    Body: FabWindow,
  },
  {
    slug: 'add-dialog',
    title: 'Add or attach dialog',
    lead: 'A bounded dialog: the search input stays at the top, the list scrolls under it, and the focus ring sits on the input’s wrapper.',
    states: [['open', 'Open']],
    height: 560,
    rules: [
      'The first row creates a page with the typed name.',
      'The dialog never grows past the viewport.',
    ],
    Body: () => <AddDialog />,
  },
  {
    slug: 'needs-you',
    title: 'Needs you',
    lead: 'The header lists what waits on you with the waiting dot and a total. Clear all asks first and only clears your list.',
    states: [
      ['menu', 'Menu open'],
      ['confirm', 'Clear all confirmation'],
    ],
    height: 420,
    rules: [
      'The dot is the waiting colour; the count is plain text.',
      'Clear all never answers, accepts or closes anything.',
    ],
    Body: NeedsYou,
  },
  {
    slug: 'work-band',
    title: 'Work band',
    lead: 'Under the page header: the page’s stage, progress and sub-pages in one band that opens in place.',
    states: [
      ['collapsed', 'Collapsed'],
      ['expanded', 'Expanded'],
    ],
    height: 300,
    rules: ['Progress is a meter plus the words; it never relies on colour alone.'],
    Body: WorkBand,
  },
  {
    slug: 'sending-rows',
    title: 'Sending, failed and unsent',
    lead: 'A message keeps its place while it sends; a failure says why and offers Retry; a draft that could not be sent stays on the device.',
    states: [['default', 'All four']],
    height: 420,
    rules: [
      'The row never jumps when its state changes.',
      'Failure is the blocked mark and a word, never red text alone.',
    ],
    Body: () => <SendingRows />,
  },
  {
    slug: 'loading-error',
    title: 'Loading and error states',
    lead: 'Loading keeps the layout with skeleton rows; an error says what failed, keeps what was on screen and offers one way on.',
    states: [
      ['loading', 'Loading'],
      ['error', 'Error'],
    ],
    height: 260,
    rules: ['Next to the Empty state: each says what would be here.'],
    Body: LoadingError,
  },
  {
    slug: 'confirm-notify',
    title: 'Confirm dialog and notifications',
    lead: 'A destructive confirmation names the object and the consequence, with Cancel focused. Notifications stack at the corner and open their destination.',
    states: [
      ['confirm', 'Confirm'],
      ['notifications', 'Notifications'],
    ],
    height: 360,
    rules: ['The destructive action is outlined in the blocked colour, never filled red.'],
    Body: ConfirmNotify,
  },
];

/** A pattern's frame page: the pattern alone, at the iframe's width and theme. */
export function PatternFrame({ params }: { params: URLSearchParams }) {
  const doc = morePatterns.find((pattern) => pattern.slug === params.get('slug'));
  const theme = params.get('theme') === 'light' ? 'light' : 'dark';
  if (!doc) return <p>Unknown pattern</p>;
  return (
    <UiTheme theme={theme}>
      <div className="pattern-frame">
        <doc.Body state={params.get('state') ?? doc.states[0]![0]} />
      </div>
    </UiTheme>
  );
}

/** The pattern at the wide width (scaled to fit) and at 390, in light and dark, for each state. */
export function PatternViewports({ doc }: { doc: PatternDoc }) {
  return (
    <>
      <ul className="docs-list">
        {doc.rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      {doc.states.map(([state, label]) => (
        <section key={state} className="docs-variant">
          <h3>{label}</h3>
          <div className="pattern-viewports">
            {(['light', 'dark'] as const).flatMap((theme) =>
              ([1440, 390] as const).map((width) => (
                <figure key={`${theme}-${width}`} className="pattern-viewport" data-width={width}>
                  <figcaption>
                    {width} · {theme}
                  </figcaption>
                  <div
                    className="pattern-viewport-box"
                    style={{ height: doc.height * (width === 1440 ? 0.5 : 1) }}
                  >
                    <iframe
                      title={`${doc.title} ${label} ${width} ${theme}`}
                      loading="lazy"
                      src={`/docs?${new URLSearchParams({ frame: 'pattern', slug: doc.slug, state, theme })}`}
                      style={{ width, height: doc.height }}
                    />
                  </div>
                </figure>
              )),
            )}
          </div>
        </section>
      ))}
    </>
  );
}
