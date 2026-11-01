import { useState, type ReactNode } from 'react';
import {
  Bookmark,
  ChevronDown,
  FileText,
  ListFilter,
  Pin,
  Plus,
  Search,
  ArrowUpDown,
} from 'lucide-react';
import { BrowserTopBar, useTopBarReady } from '../src/react.js';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  Surface,
  Tabs,
  TabsBar,
  TabsList,
  TabsTrigger,
  TooltipProvider,
} from '../src/ui/index.js';
import { RichInput, emptyRichInputValue, type RichInputValue } from '../src/rich-input/index.js';
import { StatePanel, type StateControl } from './mock-reader.js';
import { PageTable, samplePages } from '../gallery/page-table.js';
import { follow, navigate, setQuery, useQuery } from './router.js';

/*
 * The Colab page list, reconstructed (#5821, GUI lead notes 10 and 11): today's list on main
 * (home.tsx, page-list-items.tsx, page-list-search.tsx: hero actions, pinned pages, stage tabs with
 * counts, the search with its condition chip, Filter and sort, the six-column table) plus Night's
 * #5818 control row and sticky row and #5814 Needs-you cleanup, in palette B and ui parts.
 */

type Stage = 'discussion' | 'in-progress' | 'done' | 'archived';
interface Row {
  title: string;
  projects: string[];
  stage: Stage;
  needs?: number;
  work?: string;
  workers?: string[];
  updated: string;
  author: string;
  access: 'Shared' | 'Private';
  pinned?: boolean;
  unread?: boolean;
}
const rows: Row[] = [
  {
    title: 'Theme B review',
    projects: ['design', 'spec'],
    stage: 'in-progress',
    needs: 2,
    work: '3 of 5 done',
    workers: ['sample-2'],
    updated: '2 min ago',
    author: 'sample-2',
    access: 'Shared',
    pinned: true,
    unread: true,
  },
  {
    title: 'Release plan',
    projects: ['release-0.9'],
    stage: 'in-progress',
    work: '2 of 3 done',
    workers: ['sample-1', 'sample-lead'],
    updated: '18 min ago',
    author: 'sample-lead',
    access: 'Shared',
    pinned: true,
  },
  {
    title: 'Night execution plan',
    projects: ['night-shift'],
    stage: 'discussion',
    needs: 1,
    updated: '40 min ago',
    author: 'sample-lead',
    access: 'Shared',
    unread: true,
  },
  {
    title: 'Rollout checklist',
    projects: ['release-0.9', 'ops'],
    stage: 'in-progress',
    work: '0 of 2 done',
    updated: '1 h ago',
    author: 'sample-1',
    access: 'Shared',
  },
  {
    title: 'CI flake triage',
    projects: ['infra'],
    stage: 'discussion',
    updated: '3 h ago',
    author: 'sample-2',
    access: 'Private',
  },
  {
    title: 'Remote pairing walkthrough',
    projects: ['remote-launch'],
    stage: 'done',
    work: '4 of 4 done',
    updated: 'Yesterday',
    author: 'sample-1',
    access: 'Shared',
    pinned: true,
  },
  {
    title: 'Digest TUI alignment',
    projects: ['spec'],
    stage: 'discussion',
    needs: 1,
    updated: 'Yesterday',
    author: 'sample-lead',
    access: 'Shared',
  },
  {
    title: 'Token tiers',
    projects: ['design'],
    stage: 'done',
    updated: 'Mon',
    author: 'sample-2',
    access: 'Shared',
  },
  {
    title: 'Brand sheet',
    projects: ['brand'],
    stage: 'done',
    updated: '27 Oct',
    author: 'sample-lead',
    access: 'Private',
  },
  {
    title: 'Weekly plan, week 44',
    projects: ['pm'],
    stage: 'discussion',
    updated: '26 Oct',
    author: 'sample-lead',
    access: 'Shared',
  },
];
const stageName: Record<Stage, string> = {
  discussion: 'Discussion',
  'in-progress': 'In progress',
  done: 'Done',
  archived: 'Archived',
};
/** The project chip's hue: one of the data colours by the name's hash, as projectTone does. */
const projectHue = (name: string) =>
  `var(--tmt-ui-color-series-${([...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 6) + 1})`;

function ProjectChip({ name }: { name: string }) {
  return (
    <Badge variant="outline" className="list-project">
      <span
        className="list-project-dot"
        style={{ background: projectHue(name) }}
        aria-hidden="true"
      />
      {name}
    </Badge>
  );
}

const needsItems = [
  ['Theme B review', 'Answer: Which radius ships with B?'],
  ['Theme B review', 'Reply in comment 2'],
  ['Night execution plan', 'Pick the sidebar proposal'],
  ['Digest TUI alignment', 'Review the column widths'],
];

/** The top bar: All pages, the Needs-you menu (#5814: unresolvable items hidden, Clear all asks). */
function ListBar({ needs }: { needs: boolean }) {
  return useTopBarReady() ? (
    <BrowserTopBar
      title={
        <h1>
          <span className="tmt-ui-topbar-title-prefix">Colab / </span>
          <span className="tmt-ui-topbar-title-current">All pages</span>
        </h1>
      }
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="list-needs"
              aria-label={needs ? 'Needs you · 4' : 'Needs you · none'}
            >
              {needs && <span className="list-needs-dot" aria-hidden="true" />}
              <span className="list-needs-label">Needs you</span>
              <span className="list-count">{needs ? 4 : 0}</span>
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="list-needs-menu">
            {needs ? (
              <>
                {needsItems.map(([page, what]) => (
                  <DropdownMenuItem key={what} className="list-needs-item">
                    <span className="list-needs-dot" aria-hidden="true" />
                    <span>
                      <b>{page}</b>
                      <span className="list-quiet">{what}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setQuery({ clear: '1' })}>
                  Clear all…
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuLabel className="list-quiet">Nothing needs you.</DropdownMenuLabel>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  ) : null;
}

const designChip = { kind: 'project', text: 'project:design', range: { start: 0, end: 14 } };

/** The search row (#5821 C2): the chip search takes the row, then Filter and Sort, bordered at
 * control-size-l; under 760px both turn square. */
function Controls({ stuck, filtered }: { stuck: boolean; filtered: boolean }) {
  const [search, setSearch] = useState<RichInputValue>(
    filtered ? { value: 'project:design ', chips: [designChip] } : emptyRichInputValue,
  );
  const [sort, setSort] = useState('updated');
  return (
    <div className="list-controls" data-stuck={stuck || undefined}>
      <RichInput
        shape="single"
        label="Search pages"
        placeholder="Search pages, or type project:"
        value={search}
        resetKey={filtered ? 'filtered' : 'all'}
        onChange={(next) => {
          setSearch(next);
          const has = next.chips.some((chip) => chip.text === 'project:design');
          if (has !== filtered) setQuery({ filter: has ? '1' : null });
        }}
        leading={<Search aria-hidden="true" />}
        removeLabel={(_, text) => `Remove ${text}`}
        suggestions={[
          {
            kind: 'project',
            trigger: 'project:',
            options: (text) =>
              ['design', 'spec', 'release-0.9', 'night-shift']
                .filter((name) => name.startsWith(text))
                .map((name) => ({ text: `project:${name}` })),
          },
        ]}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" collapseLabel="Filter">
            <ListFilter aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Project</DropdownMenuLabel>
          {['design', 'spec', 'release-0.9', 'night-shift'].map((name) => (
            <DropdownMenuCheckboxItem
              key={name}
              checked={filtered && name === 'design'}
              onSelect={() => setQuery({ filter: filtered ? null : '1' })}
            >
              {name}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem>Needs me</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Include archived</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" collapseLabel="Sort">
            <ArrowUpDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
            <DropdownMenuRadioItem value="updated">Recently updated</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="title">Title</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const views: [string, string, number][] = [
  ['all', 'All', 38],
  ['needs', 'Needs you', 4],
  ['discussion', 'Discussion', 12],
  ['in-progress', 'In progress', 9],
  ['done', 'Done', 13],
  ['archived', 'Archived', 6],
];

export const listControls: StateControl[] = [
  {
    key: 'data',
    label: 'Data',
    options: [
      ['', 'Pages'],
      ['loading', 'Loading'],
      ['empty', 'Empty'],
      ['error', 'Error'],
    ],
  },
  {
    key: 'filter',
    label: 'Filter',
    options: [
      ['', 'None'],
      ['1', 'project: design'],
      ['none', 'Filtered to nothing'],
    ],
  },
  {
    key: 'sticky',
    label: 'Control row',
    options: [
      ['', 'In place'],
      ['1', 'Stuck'],
    ],
  },
  {
    key: 'needs',
    label: 'Needs you',
    options: [
      ['', 'Present'],
      ['cleared', 'Cleared'],
    ],
  },
  {
    key: 'clear',
    label: 'Clear all dialog',
    options: [
      ['', 'Closed'],
      ['1', 'Open'],
    ],
  },
];

const listMissing = [
  'Tabs count slot: a muted count after the label (here a span in the trigger).',
  'Stage chip: dot and word in the stage hue (here a styled span).',
  'Project chip with its hue dot: an outline Badge plus a dot.',
  'Pinned page card: a sheet Surface with icon, title and meta.',
  'Needs-you dot: the 8px waiting dot shared with the Chat unread dot.',
];

export function ListScreen({
  globals,
  controls = listControls,
}: {
  globals: ReactNode;
  controls?: StateControl[];
}) {
  const query = useQuery();
  const data = query.get('data');
  const filter = query.get('filter');
  const needs = query.get('needs') !== 'cleared';
  const [view, setView] = useState('all');
  const shown =
    filter === 'none'
      ? []
      : samplePages.filter(
          (row) =>
            (filter !== '1' || row.projects.includes('design')) &&
            (view === 'all' || (view === 'needs' ? row.needs : row.stage === view)),
        );
  return (
    <TooltipProvider>
      <ListBar needs={needs} />
      <div className="list-page">
        {data !== 'empty' && (
          <ul className="list-pins" aria-label="Pinned pages">
            {rows
              .filter((row) => row.pinned)
              .map((row) => (
                <li key={row.title}>
                  <Surface level="sheet" className="list-pin">
                    <FileText className="list-pin-icon" aria-hidden="true" />
                    <div>
                      <a href="/mock/colab/page" onClick={follow}>
                        {row.title}
                      </a>
                      <div className="list-pin-meta">
                        {row.projects.map((name) => (
                          <ProjectChip key={name} name={name} />
                        ))}
                        <span className="list-quiet">{stageName[row.stage]}</span>
                      </div>
                    </div>
                    <Pin className="list-pin-mark" aria-hidden="true" />
                  </Surface>
                </li>
              ))}
          </ul>
        )}
        <Tabs value={view} onValueChange={setView}>
          <TabsBar
            className="list-tabs-row"
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
            <TabsList variant="line" className="list-tabs" aria-label="Page views">
              {views.map(([id, label, count]) => (
                <TabsTrigger key={id} value={id}>
                  {label} <span className="list-count">{id === 'needs' && !needs ? 0 : count}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </TabsBar>
        </Tabs>
        <Controls
          stuck={query.get('sticky') === '1'}
          filtered={filter === '1' || filter === 'none'}
        />
        {data === 'loading' ? (
          <div className="list-loading" aria-label="Loading pages">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="list-skeleton" />
            ))}
          </div>
        ) : data === 'error' ? (
          <Alert>
            <AlertTitle>Could not load pages</AlertTitle>
            <AlertDescription>
              The connection to this machine dropped. Pages come back when it reconnects.
              <Button type="button" variant="outline" size="sm" className="list-retry">
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : data === 'empty' ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No pages yet</EmptyTitle>
              <EmptyDescription>
                Pages are created on your machine: tmt colab page create --title &quot;Notes&quot;
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button">New page</Button>
            </EmptyContent>
          </Empty>
        ) : shown.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No pages match</EmptyTitle>
              <EmptyDescription>
                Nothing in this view matches the search and filters.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" variant="outline" onClick={() => setQuery({ filter: null })}>
                Clear filters
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <p className="list-quiet list-status">{shown.length} pages in this view</p>
            <PageTable rows={shown} onOpen={() => navigate('/mock/colab/page')} />
          </>
        )}
        <section className="reader-notes">
          <h2>Missing parts</h2>
          <ul>
            {listMissing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
      {query.get('clear') === '1' && (
        <Dialog open onOpenChange={(open) => !open && setQuery({ clear: null })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clear all Needs-you items?</DialogTitle>
              <DialogDescription>
                The 4 items leave the menu and the counts. Their pages and threads stay as they are.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setQuery({ clear: null })}>
                Cancel
              </Button>
              <Button type="button" onClick={() => setQuery({ clear: null, needs: 'cleared' })}>
                Clear all
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <StatePanel controls={controls}>{globals}</StatePanel>
    </TooltipProvider>
  );
}
