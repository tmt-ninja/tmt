import { useLayoutEffect, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  UiTheme,
} from '../ui/index.js';

export interface PageViewFilter {
  id: string;
  label: string;
}
export interface PageViewColumn {
  id: string;
  label: string;
  visible: boolean;
  required?: boolean;
}
export interface PageViewToolbarProps {
  title: string;
  filters: readonly PageViewFilter[];
  groupBy: 'state' | 'project' | 'owner' | 'none';
  columns: readonly PageViewColumn[];
  onRemoveFilter?(id: string): void;
  onGroupChange?(group: PageViewToolbarProps['groupBy']): void;
  onColumnsChange?(columns: readonly string[]): void;
}

/** Presentation and selection only; the host owns filter values, grouping and visible columns. */
export function PageViewToolbar({
  title,
  filters,
  groupBy,
  columns,
  onRemoveFilter,
  onGroupChange,
  onColumnsChange,
}: PageViewToolbarProps) {
  const root = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => setNarrow(node.clientWidth <= 760);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const visible = columns.filter((column) => column.visible).map((column) => column.id);
  const toggle = (id: string, checked: boolean) =>
    onColumnsChange?.(checked ? [...visible, id] : visible.filter((value) => value !== id));
  const label = `Columns ${visible.length}/${columns.length}`;
  return (
    <div className="tmt-block-page-toolbar-host" ref={root}>
      <UiTheme>
        <div className="tmt-block-page-toolbar" role="toolbar" aria-label={`${title} page view`}>
          <strong>{title}</strong>
          {filters.map((filter) => (
            <span className="tmt-block-page-filter" key={filter.id}>
              {filter.label}
              <button
                type="button"
                aria-label={`Remove ${filter.label} filter`}
                disabled={!onRemoveFilter}
                onClick={() => onRemoveFilter?.(filter.id)}
              >
                ×
              </button>
            </span>
          ))}
          <label>
            Group by{' '}
            <select
              value={groupBy}
              disabled={!onGroupChange}
              onChange={(event) =>
                onGroupChange?.(event.target.value as PageViewToolbarProps['groupBy'])
              }
            >
              <option value="state">State</option>
              <option value="project">Project</option>
              <option value="owner">Owner</option>
              <option value="none">None</option>
            </select>
          </label>
          {narrow ? (
            <Sheet>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  {label}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom">
                <SheetTitle>Visible columns</SheetTitle>
                <div className="tmt-block-page-columns">
                  {columns.map((column) => (
                    <label key={column.id}>
                      <Checkbox
                        checked={column.visible}
                        disabled={column.required || !onColumnsChange}
                        onCheckedChange={(checked) => toggle(column.id, checked === true)}
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  {label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {columns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.visible}
                    disabled={column.required || !onColumnsChange}
                    onCheckedChange={(checked) => toggle(column.id, checked === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </UiTheme>
    </div>
  );
}
