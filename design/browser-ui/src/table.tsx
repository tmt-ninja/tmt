import type { ReactNode } from 'react';
import { browserUiClasses as c } from './static.js';

export interface BrowserTableProps {
  /** Names the table for assistive technology. */
  label: string;
  /** Column headings; the first column's cells are the row headings. */
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  /** Right-align, tabulate and monospace every column after the first. */
  numeric?: boolean;
  /** Column indexes a narrow container may hide (`data-hide-narrow`); the host's CSS decides when. */
  hideNarrow?: readonly number[];
  /** Column indexes whose cells never wrap (`data-nowrap`). */
  nowrap?: readonly number[];
}
export function BrowserTable({ label, columns, rows, numeric, hideNarrow, nowrap }: BrowserTableProps) {
  const cell = (index: number) => ({
    'data-hide-narrow': hideNarrow?.includes(index) ? '' : undefined,
    'data-nowrap': nowrap?.includes(index) ? '' : undefined,
  });
  return (
    <table className={c.table} aria-label={label} data-numeric={numeric || undefined}>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={column} scope="col" {...cell(index)}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            <th scope="row" {...cell(0)}>
              {row[0]}
            </th>
            {row.slice(1).map((value, column) => (
              <td key={column} {...cell(column + 1)}>
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
