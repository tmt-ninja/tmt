import { useState } from 'react';
import { RichInput, emptyRichInputValue } from '../src/rich-input/index.js';
import {
  PageListTable,
  PageListControls,
  PageListBulkActions,
  PageListRowMenu,
  PageListPins,
  PageListProjectChip,
  PageListStageChip,
  PageListTabs,
} from '../src/data-table/index.js';
import { countText } from '../src/static.js';
import { Button, UiTheme } from '../src/ui/index.js';

/** Page-list parts shown by the packaged GUI gallery in either theme. */
export function PageListFrame({ params }: { params: URLSearchParams }) {
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const [view, setView] = useState('all');
  const [search, setSearch] = useState(emptyRichInputValue);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [action, setAction] = useState('');
  return (
    <UiTheme theme={theme}>
      <main style={{ padding: 16, display: 'grid', gap: 16 }}>
        <PageListPins
          label="Pinned pages"
          pages={[
            {
              id: 'one',
              title: <a href="#one">Theme B review</a>,
              projects: ['design', 'spec'],
              stage: 'In progress',
            },
            {
              id: 'two',
              title: <a href="#two">Release plan</a>,
              projects: ['release-0.9'],
              stage: 'In progress',
            },
            {
              id: 'three',
              title: <a href="#three">Remote pairing walkthrough</a>,
              projects: ['remote-launch'],
              stage: 'Done',
            },
          ]}
        />
        <PageListTabs
          label="Page views"
          value={view}
          onChange={setView}
          formatCount={countText}
          views={[
            { id: 'all', label: 'All', count: 38 },
            { id: 'needs', label: 'Needs you', count: 4 },
            { id: 'discussion', label: 'Discussion', count: 12 },
            { id: 'in-progress', label: 'In progress', count: 9 },
            { id: 'done', label: 'Done', count: 13 },
            { id: 'archived', label: 'Archived', count: 6 },
          ]}
        />
        <PageListControls
          search={
            <RichInput
              shape="single"
              label="Search pages"
              placeholder="Search pages, or type project:"
              value={search}
              onChange={setSearch}
            />
          }
          filter={
            <Button type="button" variant="outline">
              Filter
            </Button>
          }
          sort={
            <Button type="button" variant="outline">
              Sort
            </Button>
          }
          stuck={params.has('sticky')}
        />
        <PageListTable
          selected={selected}
          onSelectedChange={setSelected}
          bulkActions={() => (
            <PageListBulkActions
              projects={[{ name: 'design', checked: false }]}
              canArchive
              canRestore
              onProject={(name) => setAction(`project:${name}`)}
              onNewProject={() => setAction('new')}
              onArchive={() => setAction('archive')}
              onRestore={() => setAction('restore')}
              onDelete={() => setAction('delete')}
            />
          )}
          menu={(page) => (
            <PageListRowMenu
              archived={false}
              readOnly={!!page.readOnly}
              onOpenInNewTab={() => setAction('open')}
              onPin={page.readOnly ? undefined : () => setAction('pin')}
              onManage={() => setAction('manage')}
              onProjects={() => setAction('projects')}
              onArchive={() => setAction('archive')}
              onDelete={() => setAction('delete')}
            />
          )}
          rows={[
            {
              id: 'one',
              name: 'Theme B review',
              title: <a href="#one">Theme B review</a>,
              projects: ['design', 'spec'],
              stage: { id: 'needs', label: 'Needs you · 2' },
              progress: '3 of 5 sub-pages done',
              updated: '2 min ago',
              author: 'sample-2',
              access: 'Shared',
              pinned: true,
              unread: true,
            },
            {
              id: 'two',
              name: 'Release plan',
              title: <a href="#two">Release plan</a>,
              projects: ['release-0.9'],
              stage: { id: 'in-progress', label: 'In progress' },
              updated: '18 min ago',
              author: 'sample-lead',
              access: 'Private',
              private: true,
            },
            {
              id: 'reader',
              name: 'Read-only page',
              title: <a href="#reader">Read-only page</a>,
              projects: [],
              updated: 'Yesterday',
              author: 'sample',
              access: 'Read-only',
              readOnly: true,
            },
          ]}
        />
        <output data-action={action} />
        <div>
          <PageListProjectChip name="design" />{' '}
          <PageListStageChip stage="in-progress" label="In progress" />{' '}
          <PageListStageChip stage="needs" label="Needs you · 2" />
        </div>
      </main>
    </UiTheme>
  );
}
