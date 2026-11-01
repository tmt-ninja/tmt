import { UiTheme } from '../src/ui/index.js';
import { PageTable, samplePages } from './page-table.js';

/** The dense data table (A6) for the e2e: `state`, `density`, `rows` and `selected` set the case. */
export function DataTableFrame({ params }: { params: URLSearchParams }) {
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const state = params.get('state');
  const count = Number(params.get('rows') ?? 12);
  return (
    <UiTheme theme={theme}>
      <main style={{ padding: 16 }}>
        <PageTable
          rows={samplePages.slice(0, count)}
          density={params.get('density') === 'comfortable' ? 'comfortable' : 'compact'}
          state={state === 'loading' || state === 'empty' || state === 'error' ? state : 'ready'}
          empty={<p>No pages match this view.</p>}
          error={<p>Could not load pages. They come back when this machine reconnects.</p>}
          initialSelected={params.get('selected')?.split(',') ?? []}
          onOpen={(page) => document.body.setAttribute('data-opened', page.id)}
        />
      </main>
    </UiTheme>
  );
}
