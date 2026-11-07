/** The `blocks` page-runtime chunk: the block parts, the data table and the page list (#6085). */
import { registerChunk } from '../register.js';
import {
  BlockDocument,
  Block,
  BlockHandle,
  BlockMenu,
  BlockMenuItem,
  BlockMenuFooter,
  BlockKbd,
  HeadingBlock,
  TextBlock,
  ListItemBlock,
  TodoBlock,
  TableBlock,
  CardBlock,
  Callout,
  CodeBlock,
  BlockMention,
  BlockToast,
  MockupBlock,
  QuestionBlock,
  ImageBlock,
  WorkBundle,
  PageView,
} from '@tmt/browser-ui/blocks';
import { DataTable, PageListTable } from '@tmt/browser-ui/data-table';
import * as React from 'react';
import { UiTheme } from '@tmt/browser-ui/ui';
function SharedPageListTable({
  livePageView,
  pageViewOptions,
  ...props
}: React.ComponentProps<typeof PageListTable> & {
  livePageView?: boolean;
  pageViewOptions?: { filters: { field: string; value: string }[]; sort: string; limit: number };
}) {
  // Live lists are drawn by the trusted parent; this frame renders only authored rows.
  let rows = livePageView ? [] : props.rows;
  if (pageViewOptions) {
    rows = rows.filter((row) =>
      pageViewOptions.filters.every((filter) =>
        filter.field === 'project'
          ? row.projects.includes(filter.value)
          : filter.field === 'state'
            ? row.stage?.id === filter.value || row.stage?.label === filter.value
            : filter.field === 'owner'
              ? row.author === filter.value
              : false,
      ),
    );
    if (pageViewOptions.sort === 'title')
      rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    else if (pageViewOptions.sort === 'updated')
      rows = [...rows].sort(
        (a, b) =>
          ((b as typeof b & { updatedAt?: number }).updatedAt ?? 0) -
          ((a as typeof a & { updatedAt?: number }).updatedAt ?? 0),
      );
    rows = rows.slice(0, pageViewOptions.limit);
  }
  if (props.rowGroup) {
    const groups = new Map<string, (typeof rows)[number][]>();
    for (const row of rows) {
      const id = props.rowGroup(row).id;
      const group = groups.get(id) ?? [];
      group.push(row);
      groups.set(id, group);
    }
    rows = [...groups.values()].flat();
  }
  const state = livePageView
    ? 'loading'
    : props.state === 'ready' && rows.length === 0
      ? 'empty'
      : props.state;
  return React.createElement(
    UiTheme,
    null,
    React.createElement(PageListTable, { ...props, rows, state }),
  );
}

registerChunk('blocks', {
  ui: {
    DataTable,
    BlockDocument,
    Block,
    BlockHandle,
    BlockMenu,
    BlockMenuItem,
    BlockMenuFooter,
    BlockKbd,
    HeadingBlock,
    TextBlock,
    ListItemBlock,
    TodoBlock,
    TableBlock,
    CardBlock,
    Callout,
    CodeBlock,
    BlockMention,
    BlockToast,
    MockupBlock,
    QuestionBlock,
    ImageBlock,
    WorkBundle,
    PageView,
  },
  parts: { PageListTable: SharedPageListTable },
});
