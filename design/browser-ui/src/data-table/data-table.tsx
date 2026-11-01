import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal } from 'lucide-react';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/index.js';
import './data-table.css';

/** What a column holds; the role sets its alignment, its phone placement and its skeleton. */
export type DataTableRole = 'primary' | 'chips' | 'status' | 'time' | 'person' | 'access' | 'text';

export interface DataTableChip {
  key: string;
  /** The chip's plain name, for the overflow chip's accessible name. */
  label: string;
  node: ReactNode;
}

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  role: DataTableRole;
  /** Narrowest width in px. The primary column takes the spare width above it. */
  min?: number;
  /** Widest width in px for a non-primary column; it stays between min and max. */
  max?: number;
  align?: 'start' | 'center' | 'end';
  /** The cell's plain text: one line, truncated, with the full text in a tooltip when cut. */
  text?: (row: Row) => string;
  /** A custom cell, in place of `text`. */
  cell?: (row: Row) => ReactNode;
  /** chips: every chip in order; the cell shows `maxChips` of them and a +N overflow chip. */
  chips?: (row: Row) => DataTableChip[];
  maxChips?: number;
  /** primary: a leading icon on the first line. */
  lead?: (row: Row) => ReactNode;
  /** primary: a second line under the text, such as progress, that never moves the other cells. */
  sub?: (row: Row) => ReactNode;
  /** Under 760px: `meta` puts the value on the card's second line, `menu` in the row menu. */
  phone?: 'meta' | 'menu';
  sortable?: boolean;
}

export interface DataTableAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

export interface DataTableSort {
  column: string;
  direction: 'ascending' | 'descending';
}

export interface DataTableProps<Row> {
  /** The table's accessible name. */
  label: string;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** A row's name in control labels: "Select …", "More for …". */
  rowLabel: (row: Row) => string;
  columns: readonly DataTableColumn<Row>[];
  density?: 'compact' | 'comfortable';
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort) => void;
  /** With onSelectedChange, a checkbox column with select all. */
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: ReadonlySet<string>) => void;
  /** The bulk bar's actions; the bar replaces the header while rows are selected. */
  bulkActions?: (selected: ReadonlySet<string>) => ReactNode;
  /** Hover and focus actions, inside the reserved actions column; also listed in the row menu. */
  actions?: (row: Row) => DataTableAction[];
  /** The row menu's own items (DropdownMenuItem and friends), after the actions. */
  menu?: (row: Row) => ReactNode;
  /** Enter on a focused row. */
  onOpen?: (row: Row) => void;
  /** Extra data-* attributes on a row, such as unread. */
  rowData?: (row: Row) => Record<string, string | undefined>;
  state?: 'ready' | 'loading' | 'empty' | 'error';
  empty?: ReactNode;
  error?: ReactNode;
  loadingRows?: number;
  className?: string;
  style?: CSSProperties;
}

/** The width under which a row becomes a two-line card; mirrored by the container query. */
export const dataTablePhoneWidth = 760;

function useNarrow() {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setNarrow(element.clientWidth < dataTablePhoneWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, narrow] as const;
}

/** One line of text; when it is cut, hovering shows the full text. */
function CellText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) =>
        setOpen(next && !!ref.current && ref.current.scrollWidth > ref.current.clientWidth)
      }
    >
      <TooltipTrigger asChild>
        <span ref={ref} className="tmt-data-table-text">
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function ChipsCell({ chips, max }: { chips: DataTableChip[]; max: number }) {
  const shown = chips.length > max ? chips.slice(0, max) : chips;
  const rest = chips.length - shown.length;
  return (
    <span className="tmt-data-table-chips">
      {shown.map((chip) => (
        <span key={chip.key} className="tmt-data-table-chip">
          {chip.node}
        </span>
      ))}
      {rest > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="tmt-data-table-more"
              aria-label={`${rest} more: ${chips
                .slice(max)
                .map((chip) => chip.label)
                .join(', ')}`}
            >
              +{rest}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="tmt-data-table-chip-list">
            {chips.map((chip) => (
              <span key={chip.key}>{chip.node}</span>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

function SortIcon({ direction }: { direction?: DataTableSort['direction'] }) {
  if (direction === 'ascending') return <ArrowUp aria-hidden="true" />;
  if (direction === 'descending') return <ArrowDown aria-hidden="true" />;
  return <ArrowUpDown aria-hidden="true" data-idle="" />;
}

/**
 * The dense data table (#5821 A6): declared columns with roles and widths, a reserved actions
 * column so hover actions never cover a cell, first-line alignment, sticky header with sort,
 * selection with a bulk bar, loading/empty/error rows, row keyboard, and two-line cards under 760px.
 * Sits inside a UiTheme island, like every ui part.
 */
export function DataTable<Row>({
  label,
  rows,
  rowKey,
  rowLabel,
  columns,
  density = 'compact',
  sort,
  onSortChange,
  selected = new Set<string>(),
  onSelectedChange,
  bulkActions,
  actions,
  menu,
  onOpen,
  rowData,
  state = 'ready',
  empty,
  error,
  loadingRows = 6,
  className,
  style,
}: DataTableProps<Row>) {
  const [root, narrow] = useNarrow();
  const body = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const selectable = !!onSelectedChange;
  const trailing = !!(actions || menu);
  const slots = actions ? Math.max(0, ...rows.map((row) => actions(row).length)) : 0;
  const keys = state === 'ready' ? rows.map(rowKey) : [];
  const focusKey = active !== null && keys.includes(active) ? active : (keys[0] ?? null);
  const chosen = keys.filter((key) => selected.has(key));
  const template = [
    selectable && 'var(--tmt-data-table-select)',
    ...columns.map((column) =>
      column.role === 'primary'
        ? `minmax(${column.min ?? 200}px, 1fr)`
        : `minmax(${column.min ?? 64}px, ${column.max ?? column.min ?? 160}px)`,
    ),
    trailing &&
      `calc(${slots + 1} * var(--tmt-foundation-control-size) + ${slots} * var(--tmt-data-table-gap) + 2 * var(--tmt-data-table-pad))`,
  ]
    .filter(Boolean)
    .join(' ');

  const setRow = (key: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    onSelectedChange?.(next);
  };
  const setAll = (on: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    onSelectedChange?.(next);
  };
  const allState =
    chosen.length === 0 ? false : chosen.length === keys.length ? true : 'indeterminate';

  const focusRow = (index: number) => {
    const target = body.current?.querySelectorAll<HTMLElement>('[data-table-row]')[index];
    target?.focus();
  };
  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, row: Row, index: number) => {
    if (event.target !== event.currentTarget) return;
    const key = rowKey(row);
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: keys.length - 1 }[
      event.key
    ];
    if (move !== undefined) {
      event.preventDefault();
      focusRow(Math.max(0, Math.min(keys.length - 1, move)));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onOpen?.(row);
    } else if (event.key === ' ' && selectable) {
      event.preventDefault();
      setRow(key, !selected.has(key));
    } else if (
      trailing &&
      (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    ) {
      event.preventDefault();
      setMenuFor(key);
    }
  };

  const cellFor = (column: DataTableColumn<Row>, row: Row) => {
    if (column.cell) return column.cell(row);
    if (column.chips) return <ChipsCell chips={column.chips(row)} max={column.maxChips ?? 2} />;
    if (column.text) return <CellText text={column.text(row)} />;
    return null;
  };

  const header = (
    <div role="row" className="tmt-data-table-row" data-head="">
      {selectable && (
        <div role="columnheader" className="tmt-data-table-cell" data-role="select">
          <Checkbox
            aria-label="Select all rows"
            checked={allState}
            disabled={keys.length === 0}
            onCheckedChange={(on) => setAll(on === true)}
          />
        </div>
      )}
      {columns.map((column) => {
        const direction = sort?.column === column.id ? sort.direction : undefined;
        return (
          <div
            key={column.id}
            role="columnheader"
            className="tmt-data-table-cell"
            data-role={column.role}
            data-align={column.align}
            data-phone={column.phone}
            aria-sort={column.sortable ? (direction ?? 'none') : undefined}
          >
            {column.sortable && onSortChange ? (
              <button
                type="button"
                className="tmt-data-table-sort"
                data-sorted={direction ? '' : undefined}
                onClick={() =>
                  onSortChange({
                    column: column.id,
                    direction: direction === 'ascending' ? 'descending' : 'ascending',
                  })
                }
              >
                {column.header}
                <SortIcon direction={direction} />
              </button>
            ) : (
              <span className="tmt-data-table-text">{column.header}</span>
            )}
          </div>
        );
      })}
      {trailing && (
        <div role="columnheader" className="tmt-data-table-cell" data-role="actions">
          <span className="tmt-data-table-hidden">Actions</span>
        </div>
      )}
    </div>
  );

  const bulk = (
    <div role="row" className="tmt-data-table-row" data-head="" data-bulk="">
      <div role="columnheader" className="tmt-data-table-cell" data-role="select">
        <Checkbox
          aria-label="Select all rows"
          checked={allState}
          onCheckedChange={(on) => setAll(on === true)}
        />
      </div>
      <div role="columnheader" className="tmt-data-table-cell tmt-data-table-bulk">
        <div role="toolbar" aria-label="Selected rows" className="tmt-data-table-bulk-bar">
          <span className="tmt-data-table-bulk-count">{chosen.length} selected</span>
          {bulkActions?.(new Set(chosen))}
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(false)}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );

  const spanRow = (content: ReactNode, kind: string) => (
    <div role="row" className="tmt-data-table-row" data-span={kind}>
      <div role="gridcell" className="tmt-data-table-cell" data-role="span">
        {content}
      </div>
    </div>
  );

  return (
    <TooltipProvider>
      <div
        ref={root}
        className={['tmt-data-table', className].filter(Boolean).join(' ')}
        data-density={density}
        data-narrow={narrow || undefined}
        data-selectable={selectable || undefined}
        style={{ ...style, '--tmt-data-table-columns': template } as CSSProperties}
      >
        <div
          role="grid"
          aria-label={label}
          aria-rowcount={keys.length + 1}
          className="tmt-data-table-grid"
        >
          <div role="rowgroup" className="tmt-data-table-head">
            {selectable && chosen.length > 0 ? bulk : header}
          </div>
          <div
            role="rowgroup"
            className="tmt-data-table-body"
            ref={body}
            aria-busy={state === 'loading' || undefined}
          >
            {state === 'loading'
              ? Array.from({ length: loadingRows }, (_, index) => (
                  <div key={index} role="row" className="tmt-data-table-row" data-loading="">
                    {selectable && (
                      <div role="gridcell" className="tmt-data-table-cell" data-role="select" />
                    )}
                    {columns.map((column) => (
                      <div
                        key={column.id}
                        role="gridcell"
                        className="tmt-data-table-cell"
                        data-role={column.role}
                        data-phone={column.phone}
                      >
                        <Skeleton className="tmt-data-table-skeleton" />
                      </div>
                    ))}
                    {trailing && (
                      <div role="gridcell" className="tmt-data-table-cell" data-role="actions" />
                    )}
                  </div>
                ))
              : state === 'empty'
                ? spanRow(empty, 'empty')
                : state === 'error'
                  ? spanRow(error, 'error')
                  : rows.map((row, index) => {
                      const key = rowKey(row);
                      const name = rowLabel(row);
                      const rowActions = actions?.(row) ?? [];
                      const menuColumns = narrow
                        ? columns.filter((column) => column.phone === 'menu')
                        : [];
                      return (
                        <div
                          key={key}
                          role="row"
                          aria-rowindex={index + 2}
                          aria-selected={selectable ? selected.has(key) : undefined}
                          className="tmt-data-table-row"
                          data-table-row=""
                          data-selected={selected.has(key) || undefined}
                          tabIndex={key === focusKey ? 0 : -1}
                          onFocus={() => setActive(key)}
                          onKeyDown={(event) => onRowKey(event, row, index)}
                          {...Object.fromEntries(
                            Object.entries(rowData?.(row) ?? {}).map(([name, value]) => [
                              `data-${name}`,
                              value,
                            ]),
                          )}
                        >
                          {selectable && (
                            <div role="gridcell" className="tmt-data-table-cell" data-role="select">
                              <Checkbox
                                tabIndex={-1}
                                aria-label={`Select ${name}`}
                                checked={selected.has(key)}
                                onCheckedChange={(on) => setRow(key, on === true)}
                              />
                            </div>
                          )}
                          {columns.map((column) => (
                            <div
                              key={column.id}
                              role="gridcell"
                              className="tmt-data-table-cell"
                              data-role={column.role}
                              data-align={column.align}
                              data-phone={column.phone}
                            >
                              {column.role === 'primary' ? (
                                <>
                                  <span className="tmt-data-table-line">
                                    {column.lead?.(row)}
                                    {cellFor(column, row)}
                                  </span>
                                  {column.sub && (
                                    <span className="tmt-data-table-sub">{column.sub(row)}</span>
                                  )}
                                </>
                              ) : (
                                cellFor(column, row)
                              )}
                            </div>
                          ))}
                          {trailing && (
                            <div
                              role="gridcell"
                              className="tmt-data-table-cell"
                              data-role="actions"
                            >
                              <span className="tmt-data-table-actions">
                                {rowActions.map((action) => (
                                  <Tooltip key={action.id}>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        tabIndex={-1}
                                        aria-label={action.label}
                                        onClick={action.onSelect}
                                      >
                                        {action.icon}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{action.label}</TooltipContent>
                                  </Tooltip>
                                ))}
                              </span>
                              <DropdownMenu
                                open={menuFor === key}
                                onOpenChange={(open) => setMenuFor(open ? key : null)}
                              >
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    tabIndex={-1}
                                    className="tmt-data-table-menu"
                                    aria-label={`More for ${name}`}
                                  >
                                    <MoreHorizontal aria-hidden="true" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {menuColumns.map((column) => (
                                    <DropdownMenuLabel
                                      key={column.id}
                                      className="tmt-data-table-menu-fact"
                                    >
                                      {column.header}: {column.text?.(row) ?? ''}
                                    </DropdownMenuLabel>
                                  ))}
                                  {menuColumns.length > 0 && <DropdownMenuSeparator />}
                                  {rowActions.map((action) => (
                                    <DropdownMenuItem key={action.id} onSelect={action.onSelect}>
                                      {action.icon}
                                      {action.label}
                                    </DropdownMenuItem>
                                  ))}
                                  {rowActions.length > 0 && menu && <DropdownMenuSeparator />}
                                  {menu?.(row)}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                        </div>
                      );
                    })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
