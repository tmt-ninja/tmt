import { countText } from '../src/static.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vite-plus/test';
import {
  PageListPins,
  PageListProjectChip,
  PageListStageChip,
  PageListTabs,
  PageListControls,
  PageListBulkActions,
  PageListProjectPicker,
  PageListLoading,
  PageListError,
} from '../src/data-table/page-list.js';
import { PageListTable } from '../src/data-table/index.js';
import { UiTheme } from '../src/ui/theme.js';

it('renders a pinned page with its supplied link, project chips and stage', () => {
  const html = renderToStaticMarkup(
    <PageListPins
      label="Pinned pages"
      pages={[
        {
          id: 'page-1',
          title: <a href="/colab/pages/page-1">A long page title</a>,
          projects: ['design', 'spec'],
          stage: 'In progress',
        },
      ]}
    />,
  );
  expect(html).toContain('aria-label="Pinned pages"');
  expect(html).toContain('href="/colab/pages/page-1"');
  expect(html).toContain('A long page title');
  expect(html).toContain('design');
  expect(html).toContain('spec');
  expect(html).toContain('In progress');
});

it('renders project and stage chips with their supplied accessible text', () => {
  const project = renderToStaticMarkup(<PageListProjectChip name="design" />);
  const stage = renderToStaticMarkup(<PageListStageChip stage="in-progress" label="In progress" />);
  expect(project).toContain('design');
  expect(project).toContain('tmt-page-list-project-dot');
  expect(stage).toContain('data-stage="in-progress"');
  expect(stage).toContain('In progress');
});

it('renders the six page columns, progress and real link in the shared table', () => {
  const html = renderToStaticMarkup(
    <UiTheme>
      <PageListTable
        rows={[
          {
            id: 'p1',
            name: 'A long page',
            title: <a href="/page/p1">A long page</a>,
            projects: ['design'],
            stage: { id: 'in-progress', label: 'In progress' },
            progress: '3 of 5 sub-pages done',
            updated: '2 min ago',
            author: 'sample',
            access: 'Private',
            private: true,
          },
        ]}
      />
    </UiTheme>,
  );
  for (const label of [
    'Title',
    'Project',
    'Stage',
    'Updated',
    'Author',
    'Access',
    '3 of 5 sub-pages done',
  ])
    expect(html).toContain(label);
  expect(html).toContain('href="/page/p1"');
  expect(html).toContain('data-page-id="p1"');
});

it('shows page-view labels and counts with the supplied actions', () => {
  const html = renderToStaticMarkup(
    <UiTheme>
      <PageListTabs
        label="Page views"
        value="all"
        onChange={() => {}}
        formatCount={countText}
        views={[
          { id: 'all', label: 'All', count: 38 },
          { id: 'needs', label: 'Needs you', count: 4 },
        ]}
        actions={<button type="button">New page</button>}
      />
    </UiTheme>,
  );
  expect(html).toContain('aria-label="Page views"');
  for (const word of ['All', '38', 'Needs you', '4', 'New page']) expect(html).toContain(word);
});

it('keeps search, Filter and Sort in one shared sticky controls row', () => {
  const html = renderToStaticMarkup(
    <PageListControls
      stuck
      search={<input aria-label="Search pages" />}
      filter={<button type="button">Filter</button>}
      sort={<button type="button">Sort</button>}
      trailing={<button type="button">New page</button>}
    />,
  );
  expect(html).toContain('data-stuck="true"');
  expect(html).toContain('Search pages');
  expect(html.indexOf('Filter')).toBeLessThan(html.indexOf('Sort'));
  expect(html.indexOf('Sort')).toBeLessThan(html.indexOf('New page'));
});

it('keeps read-only rows out of bulk selection', () => {
  const html = renderToStaticMarkup(
    <UiTheme>
      <PageListTable
        rows={[
          {
            id: 'p1',
            name: 'Read only',
            title: <a href="/page/p1">Read only</a>,
            projects: [],
            updated: '',
            author: '',
            access: 'Read-only',
            readOnly: true,
          },
        ]}
        selected={new Set()}
        onSelectedChange={() => {}}
      />
    </UiTheme>,
  );
  expect(html).toMatch(/<button(?=[^>]*aria-label="Select Read only")(?=[^>]*disabled)[^>]*>/);
  expect(html).toContain('Read-only');
});

it('shows the approved bulk and read-only row actions', () => {
  const html = renderToStaticMarkup(
    <UiTheme>
      <PageListBulkActions
        projects={[]}
        onProject={() => {}}
        onNewProject={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onDelete={() => {}}
        canArchive
        canRestore
      />
    </UiTheme>,
  );
  for (const label of ['Archive', 'Restore', 'Projects', 'More']) expect(html).toContain(label);
});

it('exposes a shared project-picker trigger with the current memberships', () => {
  const html = renderToStaticMarkup(
    <UiTheme>
      <PageListProjectPicker
        label="Projects for page"
        projects={[
          { name: 'design', checked: true },
          { name: 'spec', checked: true },
        ]}
        selectedOrder={['spec', 'design']}
        open={false}
        onOpenChange={() => {}}
        onProject={() => {}}
        onNewProject={() => {}}
      />
    </UiTheme>,
  );
  expect(html).toContain('aria-label="Projects for page"');
  expect(html).toContain('spec');
  expect(html).toContain('+1');
});

it('counts the selected keys across a lazily rendered page list', () => {
  const html = renderToStaticMarkup(
    <UiTheme>
      <PageListTable
        rows={[
          {
            id: 'one',
            name: 'One',
            title: 'One',
            projects: [],
            updated: '',
            author: '',
            access: 'Private',
            private: true,
          },
        ]}
        selected={new Set(['one', 'two'])}
        onSelectedChange={() => {}}
        selectionKeys={['one', 'two']}
      />
    </UiTheme>,
  );
  expect(html).toContain('2 selected');
});

it('renders the mock loading and connection-error states', () => {
  const loading = renderToStaticMarkup(<PageListLoading />);
  expect(loading.match(/data-slot="skeleton"/g)).toHaveLength(6);
  expect(loading).toContain('Loading pages');
  const error = renderToStaticMarkup(<PageListError onRetry={() => {}} />);
  expect(error).toContain('Could not load pages');
  expect(error).toContain('Try again');
});
