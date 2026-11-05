import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PageViewToolbar } from '@tmt/browser-ui/blocks';
import { UiTheme } from '@tmt/browser-ui/ui';
import { PageListTable, type PageListRow } from '@tmt/browser-ui/data-table';
import '@tmt/browser-ui/blocks.css';
import '@tmt/browser-ui/page-list.css';
import '@tmt/browser-ui/data-table.css';
import type { PageViewRecord } from './page-view-source.js';

export interface ParentPageViewSpec {
  tag: string;
  index: number;
  title: string;
  filters: { field: 'project' | 'state' | 'owner'; value: string }[];
  limit: number;
  sort: 'title' | 'updated';
  groupBy: 'state' | 'project' | 'owner' | 'none';
  columns: string[];
  density: 'compact' | 'comfortable';
  selectable: boolean;
  selected?: string;
  state: 'auto' | 'loading' | 'empty' | 'error';
}
export type ParentPageViewSource = (
  publish: (rows: PageViewRecord[]) => void,
  failed: () => void,
) => () => void;

/** One owner-list subscription serves every admitted slot in this frame. */
export function shareParentPageViews(source: ParentPageViewSource): ParentPageViewSource {
  const listeners = new Set<{ publish: (rows: PageViewRecord[]) => void; failed: () => void }>();
  let current: PageViewRecord[] | null | undefined;
  let stop: (() => void) | undefined;
  return (publish, failed) => {
    const listener = { publish, failed };
    listeners.add(listener);
    if (current === null) failed();
    else if (current !== undefined) publish(current);
    if (!stop) {
      stop = source(
        (rows) => {
          current = rows;
          listeners.forEach((item) => item.publish(rows));
        },
        () => {
          current = null;
          listeners.forEach((item) => item.failed());
        },
      );
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        stop?.();
        stop = undefined;
        current = undefined;
      }
    };
  };
}

/** This component and all page metadata stay in the trusted parent, outside the page frame. */
function ParentPageView({
  spec,
  source,
  onHeight,
}: {
  spec: ParentPageViewSpec;
  source?: ParentPageViewSource;
  onHeight: (height: number) => void;
}) {
  const [rows, setRows] = useState<PageViewRecord[] | null | undefined>(undefined);
  const [filters, setFilters] = useState(spec.filters);
  const [groupBy, setGroupBy] = useState(spec.groupBy);
  const [visible, setVisible] = useState<readonly string[]>(spec.columns);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(spec.selected ? [spec.selected] : []),
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!source) {
      setRows(null);
      return;
    }
    return source(setRows, () => setRows(null));
  }, [source]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => onHeight(Math.ceil(element.getBoundingClientRect().height));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [onHeight]);
  const displayed = useMemo(() => {
    const filtered = (rows ?? []).filter((row) =>
      filters.every(({ field, value }) =>
        field === 'project'
          ? row.projects.includes(value)
          : field === 'state'
            ? row.stage === value
            : row.author === value,
      ),
    );
    filtered.sort((a, b) =>
      spec.sort === 'title'
        ? a.name.localeCompare(b.name)
        : (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
    return filtered.slice(0, spec.limit).map((row) => ({
      ...row,
      title: <a href={row.href}>{row.name}</a>,
      stage: row.stage ? { id: row.stage, label: row.stage } : undefined,
    }));
  }, [rows, filters, spec.limit, spec.sort]);
  const group = (row: PageListRow) =>
    groupBy === 'state'
      ? row.stage?.label || 'No stage'
      : groupBy === 'project'
        ? row.projects[0] || 'No project'
        : groupBy === 'owner'
          ? row.author || 'No owner'
          : '';
  const groups = new Map<string, typeof displayed>();
  for (const row of displayed) {
    const key = group(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const columns = [
    { id: 'title', label: 'Page', required: true },
    { id: 'state', label: 'State' },
    { id: 'progress', label: 'Sub-pages' },
    { id: 'owner', label: 'Owner' },
    { id: 'updated', label: 'Updated' },
  ].map((column) => ({ ...column, visible: visible.includes(column.id) }));
  const state =
    spec.state === 'auto'
      ? rows === undefined
        ? 'loading'
        : rows === null
          ? 'error'
          : displayed.length
            ? 'ready'
            : 'empty'
      : spec.state;
  return (
    <div ref={root}>
      <UiTheme>
        <section className="tmt-block-page-view" aria-label={spec.title}>
          <PageViewToolbar
            title={spec.title}
            filters={filters.map((filter, index) => ({
              id: String(index),
              label: `${filter.field}: ${filter.value}`,
            }))}
            groupBy={groupBy}
            columns={columns}
            onGroupChange={setGroupBy}
            onColumnsChange={setVisible}
            onRemoveFilter={(id) =>
              setFilters((current) => current.filter((_, index) => String(index) !== id))
            }
          />
          <PageListTable
            pageView
            rows={[...groups.values()].flat()}
            state={state}
            density={spec.density}
            selected={selected}
            onSelectedChange={spec.selectable ? setSelected : undefined}
            visibleColumns={visible}
            rowGroup={
              groupBy === 'none' ? undefined : (row) => ({ id: group(row), label: group(row) })
            }
            collapsedGroups={collapsed}
            onGroupToggle={(id) =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            empty="No matching pages"
            error="Page list unavailable"
          />
        </section>
      </UiTheme>
    </div>
  );
}

export function mountParentPageView(
  host: HTMLElement,
  spec: ParentPageViewSpec,
  source: ParentPageViewSource | undefined,
  onHeight: (height: number) => void,
) {
  const root = createRoot(host);
  root.render(<ParentPageView spec={spec} source={source} onHeight={onHeight} />);
  return () => root.unmount();
}
