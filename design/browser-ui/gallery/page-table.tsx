import { useMemo, useState } from 'react';
import { Archive, ExternalLink, FileText, Lock, Pin, Trash2, Users } from 'lucide-react';
import {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type DataTableSort,
} from '../src/data-table/index.js';
import { Badge, Button, DropdownMenuItem } from '../src/ui/index.js';

/*
 * The Colab page list on DataTable (#5821 A6/C9), with sample data shared by the gallery frame, the
 * /docs pattern and the /mock/colab list. Titles include CJK text on purpose: the table must
 * truncate and align it like Latin text (fixture data, see AGENTS.md language exceptions).
 */
export type PageStage = 'discussion' | 'in-progress' | 'done' | 'archived';
export interface SamplePage {
  id: string;
  title: string;
  projects: string[];
  stage: PageStage;
  needs?: number;
  progress?: [done: number, total: number];
  updated: string;
  updatedRank: number;
  author: string;
  access: 'Shared' | 'Private';
  pinned?: boolean;
  unread?: boolean;
}

const titles = [
  'Theme B review',
  'PM 狀態快報',
  'Release plan for the 0.9 line, with the upgrade path and the rollback notes for every host',
  '回覆不再默默消失',
  'Night 設計：編輯提示與舊歷史清理',
  'Usage report',
  'Design: revised catalog and preview frames for every component page',
  'Design 定義：token、atoms、patterns 與 cli-style',
  'What 1% buys on Claude and Codex',
  'Rollout checklist',
  'CI flake triage',
  'Remote pairing walkthrough',
  'Digest TUI alignment',
  'Token tiers',
  'Brand sheet',
];
const projectSets = [
  ['design', 'spec'],
  ['pm'],
  ['release-0.9', 'ops', 'remote-launch'],
  ['spec'],
  ['night-shift', 'design'],
  ['pm'],
  [],
  ['design', 'docs'],
  ['blog'],
  ['release-0.9', 'ops'],
  ['infra'],
  ['remote-launch'],
  ['spec', 'tui', 'digest'],
  ['design'],
  ['brand'],
];
const stages: PageStage[] = ['in-progress', 'discussion', 'done', 'archived'];
const people = ['sample-lead', 'sample-1', 'sample-2'];
const times = [
  '2 min ago',
  '18 min ago',
  '34 min ago',
  '1 h ago',
  '3 h ago',
  '13 h ago',
  'Yesterday',
  'Mon',
  '27 Oct',
];

/** Sixty pages: every title, stage, project count, progress and access, in a stable order. */
export const samplePages: SamplePage[] = Array.from({ length: 60 }, (_, index) => {
  const at = index % titles.length;
  const round = Math.floor(index / titles.length);
  const stage = stages[(index + round) % stages.length]!;
  return {
    id: `page-${index + 1}`,
    title: round === 0 ? titles[at]! : `${titles[at]} (${round + 1})`,
    projects: projectSets[at]!,
    stage,
    needs: index % 7 === 0 ? (index % 3) + 1 : undefined,
    progress: stage === 'in-progress' && index % 2 === 0 ? [index % 5, 16] : undefined,
    updated: times[Math.min(times.length - 1, Math.floor(index / 7))]!,
    updatedRank: index,
    author: people[index % people.length]!,
    access: index % 4 === 1 ? 'Shared' : 'Private',
    pinned: index < 3,
    unread: index % 5 === 0,
  };
});

const stageName: Record<PageStage, string> = {
  discussion: 'Discussion',
  'in-progress': 'In progress',
  done: 'Done',
  archived: 'Archived',
};
/** The project chip's hue: one of the data colours by the name's hash, as Colab's projectTone does. */
const projectHue = (name: string) =>
  `var(--tmt-ui-color-series-${([...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 6) + 1})`;

function ProjectChip({ name }: { name: string }) {
  return (
    <Badge variant="outline" className="page-table-chip">
      <span
        className="page-table-dot"
        style={{ background: projectHue(name) }}
        aria-hidden="true"
      />
      {name}
    </Badge>
  );
}
function StageChip({ page }: { page: SamplePage }) {
  return page.needs ? (
    <Badge variant="outline" className="page-table-chip" data-stage="needs">
      <span className="page-table-dot" aria-hidden="true" />
      Needs you · {page.needs}
    </Badge>
  ) : (
    <Badge variant="outline" className="page-table-chip" data-stage={page.stage}>
      <span className="page-table-dot" aria-hidden="true" />
      {stageName[page.stage]}
    </Badge>
  );
}

export const pageColumns: DataTableColumn<SamplePage>[] = [
  {
    id: 'title',
    header: 'Title',
    role: 'primary',
    min: 220,
    sortable: true,
    text: (page) => page.title,
    lead: (page) => (page.pinned ? <Pin aria-label="Pinned" /> : <FileText aria-hidden="true" />),
    sub: (page) =>
      page.progress ? `${page.progress[0]} of ${page.progress[1]} sub-pages done` : null,
  },
  {
    id: 'project',
    header: 'Project',
    role: 'chips',
    min: 120,
    max: 200,
    maxChips: 1,
    phone: 'meta',
    chips: (page) =>
      page.projects.map((name) => ({ key: name, label: name, node: <ProjectChip name={name} /> })),
  },
  {
    id: 'stage',
    header: 'Stage',
    role: 'status',
    min: 120,
    max: 140,
    phone: 'meta',
    cell: (page) => <StageChip page={page} />,
  },
  {
    id: 'updated',
    header: 'Updated',
    role: 'time',
    min: 88,
    max: 104,
    phone: 'meta',
    sortable: true,
    text: (page) => page.updated,
  },
  {
    id: 'author',
    header: 'Author',
    role: 'person',
    min: 96,
    max: 120,
    phone: 'menu',
    text: (page) => page.author,
  },
  {
    id: 'access',
    header: 'Access',
    role: 'access',
    min: 84,
    max: 96,
    phone: 'menu',
    text: (page) => page.access,
    cell: (page) => (
      <>
        {page.access === 'Private' ? <Lock aria-hidden="true" /> : <Users aria-hidden="true" />}
        <span className="tmt-data-table-text">{page.access}</span>
      </>
    ),
  },
];

const compare = (sort: DataTableSort) => (a: SamplePage, b: SamplePage) => {
  const order =
    sort.column === 'title' ? a.title.localeCompare(b.title) : a.updatedRank - b.updatedRank;
  return sort.direction === 'ascending' ? order : -order;
};

/** The page list as Colab would build it: sort, selection with bulk actions, hover actions, menu. */
export function PageTable({
  rows = samplePages,
  initialSelected = [],
  onOpen,
  ...props
}: Partial<Omit<DataTableProps<SamplePage>, 'rows'>> & {
  rows?: readonly SamplePage[];
  initialSelected?: string[];
}) {
  const [sort, setSort] = useState<DataTableSort>({ column: 'updated', direction: 'ascending' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initialSelected));
  const sorted = useMemo(() => [...rows].sort(compare(sort)), [rows, sort]);
  return (
    <DataTable
      label="Pages"
      rows={sorted}
      rowKey={(page) => page.id}
      rowLabel={(page) => page.title}
      columns={pageColumns}
      sort={sort}
      onSortChange={setSort}
      selected={selected}
      onSelectedChange={setSelected}
      bulkActions={() => (
        <>
          <Button type="button" variant="outline" size="sm">
            <Archive aria-hidden="true" /> Archive
          </Button>
          <Button type="button" variant="outline" size="sm">
            Move to project
          </Button>
        </>
      )}
      actions={(page) => [
        {
          id: 'open',
          label: `Open ${page.title} in a new tab`,
          icon: <ExternalLink aria-hidden="true" />,
          onSelect: () => {},
        },
        {
          id: 'pin',
          label: page.pinned ? `Unpin ${page.title}` : `Pin ${page.title} to the top`,
          icon: <Pin aria-hidden="true" />,
          onSelect: () => {},
        },
        {
          id: 'archive',
          label: `Archive ${page.title}`,
          icon: <Archive aria-hidden="true" />,
          onSelect: () => {},
        },
      ]}
      menu={() => (
        <>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Move to project…</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">
            <Trash2 aria-hidden="true" /> Delete
          </DropdownMenuItem>
        </>
      )}
      onOpen={onOpen ?? (() => {})}
      rowData={(page) => ({ unread: page.unread ? '' : undefined })}
      {...props}
    />
  );
}
