import type { ReactNode } from 'react';
import { Eye, FileText, Lock, Pin, Users } from 'lucide-react';
import { PageListProjectChip, PageListStageChip } from './page-list.js';
import { DataTable, type DataTableColumn, type DataTableProps } from './data-table.js';

/** Presentation data only. The host owns page state, links, selection and actions. */
export interface PageListRow {
  id: string;
  name: string;
  title: ReactNode;
  projects: readonly string[];
  projectPicker?: ReactNode;
  onProjectFilter?: (name: string) => void;
  activeProjects?: readonly string[];
  stage?: { id: string; label: string };
  progress?: ReactNode;
  updated: string;
  updatedDateTime?: string;
  updatedTitle?: string;
  author: string;
  access: string;
  private?: boolean;
  readOnly?: boolean;
  pinned?: boolean;
  unread?: boolean;
}

const columns: DataTableColumn<PageListRow>[] = [
  {
    id: 'title',
    header: 'Title',
    role: 'primary',
    min: 140,
    sortable: true,
    text: (page) => page.name,
    cell: (page) => page.title,
    lead: (page) => (page.pinned ? <Pin aria-label="Pinned" /> : <FileText aria-hidden="true" />),
    sub: (page) => page.progress,
  },
  {
    id: 'project',
    header: 'Project',
    role: 'chips',
    min: 96,
    max: 200,
    maxChips: 1,
    phone: 'meta',
    cell: (page) => page.projectPicker,
    chips: (page) =>
      page.projects.map((name) => ({
        key: name,
        label: name,
        node: page.onProjectFilter ? (
          <button
            type="button"
            className="tmt-page-list-project-filter"
            aria-pressed={page.activeProjects?.includes(name) ?? false}
            onClick={(event) => {
              if (event.nativeEvent.isTrusted) page.onProjectFilter?.(name);
            }}
          >
            <PageListProjectChip name={name} />
          </button>
        ) : (
          <PageListProjectChip name={name} />
        ),
      })),
  },
  {
    id: 'stage',
    header: 'Stage',
    role: 'status',
    min: 100,
    max: 140,
    phone: 'meta',
    cell: (page) =>
      page.stage ? <PageListStageChip stage={page.stage.id} label={page.stage.label} /> : null,
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
    cell: (page) =>
      page.updatedDateTime ? (
        <time dateTime={page.updatedDateTime} title={page.updatedTitle}>
          {page.updated}
        </time>
      ) : (
        page.updated
      ),
  },
  {
    id: 'author',
    header: 'Author',
    role: 'person',
    min: 72,
    max: 120,
    phone: 'menu',
    text: (page) => page.author,
  },
  {
    id: 'access',
    header: 'Access',
    role: 'access',
    min: 70,
    max: 96,
    phone: 'menu',
    text: (page) => page.access,
    cell: (page) => (
      <>
        {page.readOnly ? (
          <Eye aria-hidden="true" />
        ) : page.private ? (
          <Lock aria-hidden="true" />
        ) : (
          <Users aria-hidden="true" />
        )}
        <span className="tmt-data-table-text">{page.access}</span>
      </>
    ),
  },
];

export function PageListTable({
  rows,
  actions,
  visibleColumns,
  ...props
}: Omit<
  DataTableProps<PageListRow>,
  'label' | 'rows' | 'rowKey' | 'rowLabel' | 'columns' | 'canSelect'
> & {
  rows: readonly PageListRow[];
  /** Optional column selection. The title is always present. */
  visibleColumns?: readonly string[];
}) {
  return (
    <DataTable
      label="Pages"
      rows={rows}
      rowKey={(page) => page.id}
      rowLabel={(page) => page.name}
      columns={
        visibleColumns
          ? columns.filter((column) => column.id === 'title' || visibleColumns.includes(column.id))
          : columns
      }
      selectAllLabel="Select all matching pages"
      includeActionsInMenu={false}
      canSelect={(page) => !page.readOnly}
      actions={actions ? (page) => (page.readOnly ? [] : actions(page)) : undefined}
      rowData={(page) => ({ 'page-id': page.id, unread: page.unread ? '' : undefined })}
      {...props}
    />
  );
}
