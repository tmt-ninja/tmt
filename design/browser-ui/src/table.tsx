import type { ReactNode } from 'react';
import { browserUiClasses as c } from './static.js';

export interface BrowserTableProps {
  /** Names the table for assistive technology. */
  label: string;
  /** Column headings (an editor's name field while renaming); the first column's cells are the
   * row headings. */
  columns: readonly ReactNode[];
  rows: readonly (readonly ReactNode[])[];
  /** Right-align, tabulate and monospace every column after the first. */
  numeric?: boolean;
  /** Column indexes a narrow container may hide (`data-hide-narrow`); the host's CSS decides when. */
  hideNarrow?: readonly number[];
  /** Column indexes whose cells never wrap (`data-nowrap`). */
  nowrap?: readonly number[];
  /** With no rows: one row across every column holding this (an editor's "Add a row"). */
  empty?: ReactNode;
  /** Stable keys for the columns and rows (an editor's IDs); names and indexes otherwise. */
  columnKeys?: readonly string[];
  rowKeys?: readonly string[];
  /** A control after each column's heading (an editor's column menu), shown while the heading is
   * hovered or holds focus, and always on a device without hover; the table block styles it. */
  columnActions?: readonly ReactNode[];
  /** A control at the end of each row (an editor's row menu), in a last column named
   * `rowActionsLabel`; shown as the column actions are. */
  rowActions?: readonly ReactNode[];
  rowActionsLabel?: string;
}
export function BrowserTable({
  label,
  columns,
  rows,
  numeric,
  hideNarrow,
  nowrap,
  empty,
  columnKeys,
  rowKeys,
  columnActions,
  rowActions,
  rowActionsLabel,
}: BrowserTableProps) {
  const cell = (index: number) => ({
    'data-hide-narrow': hideNarrow?.includes(index) ? '' : undefined,
    'data-nowrap': nowrap?.includes(index) ? '' : undefined,
  });
  const trailing = rowActions !== undefined;
  const rowEnd = (index: number) =>
    trailing && (
      <td data-row-actions="">
        <span className="tmt-block-table-action">{rowActions[index]}</span>
      </td>
    );
  return (
    <table className={c.table} aria-label={label} data-numeric={numeric || undefined}>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th
              key={columnKeys?.[index] ?? (typeof column === 'string' ? column : index)}
              scope="col"
              {...cell(index)}
            >
              {columnActions?.[index] === undefined ? (
                column
              ) : (
                <span className="tmt-block-table-heading">
                  <span>{column}</span>
                  <span className="tmt-block-table-action">{columnActions[index]}</span>
                </span>
              )}
            </th>
          ))}
          {trailing && (
            <th scope="col" data-row-actions="">
              <span className={c.visuallyHidden}>{rowActionsLabel}</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {!rows.length && empty !== undefined && (
          <tr>
            <td colSpan={Math.max(1, columns.length + (trailing ? 1 : 0))} data-empty="">
              {empty}
            </td>
          </tr>
        )}
        {rows.map((row, index) => (
          <tr key={rowKeys?.[index] ?? index}>
            <th scope="row" {...cell(0)}>
              {row[0]}
            </th>
            {row.slice(1).map((value, column) => (
              <td key={columnKeys?.[column + 1] ?? column} {...cell(column + 1)}>
                {value}
              </td>
            ))}
            {rowEnd(index)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
