import { describe, expect, it } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageView } from '../src/blocks/page-view.js';
import { PageListTable } from '../src/data-table/page-list-table.js';
import { UiTheme } from '../src/ui/theme.js';

describe('page view', () => {
  it('uses the shared page-list grid and groups admitted rows by stage', () => {
    const html = renderToStaticMarkup(
      <PageView
        title="Pages"
        rows={[
          {
            id: 'one',
            name: 'One',
            title: 'One',
            projects: ['gui'],
            stage: { id: 'open', label: 'Open' },
            updated: 'Today',
            author: 'Ben',
            access: 'Team',
          },
          {
            id: 'two',
            name: 'Two',
            title: 'Two',
            projects: [],
            stage: { id: 'open', label: 'Open' },
            updated: 'Today',
            author: 'Ben',
            access: 'Team',
          },
        ]}
      />,
    );
    expect(html).toContain('role="grid"');
    expect(html.match(/role="grid"/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Open');
    expect(html).toContain('data-page-id="one"');
    expect(html).toContain('data-page-id="two"');
    expect(html).toContain('tmt-page-view-state');
  });
  it('keeps the existing Colab list stage chip', () => {
    const html = renderToStaticMarkup(
      <UiTheme>
        <PageListTable
          rows={[
            {
              id: 'one',
              name: 'One',
              title: 'One',
              projects: [],
              stage: { id: 'open', label: 'Open' },
              updated: 'Today',
              author: 'Ben',
              access: 'Team',
            },
          ]}
        />
      </UiTheme>,
    );
    expect(html).toContain('tmt-page-list-stage');
    expect(html).not.toContain('tmt-page-view-state');
  });
  it('shows an explicit empty state', () => {
    expect(renderToStaticMarkup(<PageView title="Pages" rows={[]} />)).toContain(
      'No matching pages',
    );
  });
});
