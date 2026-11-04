import { useMemo, useState } from 'react';
import { PageListTable, type PageListRow } from '../data-table/index.js';
import { UiTheme } from '../ui/index.js';
import {
  PageViewToolbar,
  type PageViewFilter,
  type PageViewToolbarProps,
} from './page-view-toolbar.js';

export interface PageViewProps {
  title: string;
  rows: readonly PageListRow[];
  filters?: readonly PageViewFilter[];
  state?: 'ready' | 'loading' | 'error';
  onRemoveFilter?(id: string): void;
  onOpen?(row: PageListRow): void;
}

const allColumns = [
  { id: 'title', label: 'Page', required: true },
  { id: 'project', label: 'Project' },
  { id: 'stage', label: 'Stage' },
  { id: 'updated', label: 'Updated' },
  { id: 'author', label: 'Owner' },
  { id: 'access', label: 'Access' },
];
function groupName(row: PageListRow, groupBy: PageViewToolbarProps['groupBy']) {
  return groupBy === 'state'
    ? (row.stage?.label ?? 'No stage')
    : groupBy === 'project'
      ? (row.projects[0] ?? 'No project')
      : groupBy === 'owner'
        ? row.author || 'No owner'
        : '';
}

/** The caller owns admitted page data; the view owns its grouping and presentation controls. */
export function PageView({
  title,
  rows,
  filters = [],
  state = 'ready',
  onRemoveFilter,
  onOpen,
}: PageViewProps) {
  const [groupBy, setGroupBy] = useState<PageViewToolbarProps['groupBy']>('state');
  const [visible, setVisible] = useState<readonly string[]>(allColumns.map((column) => column.id));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => {
    const result = new Map<string, PageListRow[]>();
    for (const row of rows) {
      const key = groupName(row, groupBy);
      const group = result.get(key) ?? [];
      group.push(row);
      result.set(key, group);
    }
    return [...result];
  }, [rows, groupBy]);
  const columns = allColumns.map((column) => ({ ...column, visible: visible.includes(column.id) }));
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <UiTheme>
      <section className="tmt-block-page-view" aria-label={title}>
        <PageViewToolbar
          title={title}
          filters={filters}
          groupBy={groupBy}
          columns={columns}
          onRemoveFilter={onRemoveFilter}
          onGroupChange={setGroupBy}
          onColumnsChange={setVisible}
        />
        <PageListTable
          rows={groups.flatMap(([, group]) => group)}
          state={state === 'ready' && groups.length === 0 ? 'empty' : state}
          visibleColumns={visible}
          rowGroup={
            groupBy === 'none'
              ? undefined
              : (row) => {
                  const name = groupName(row, groupBy);
                  return { id: name, label: name };
                }
          }
          collapsedGroups={collapsed}
          onGroupToggle={toggle}
          onOpen={onOpen}
          empty="No matching pages"
          error="Pages could not be loaded"
        />
      </section>
    </UiTheme>
  );
}
