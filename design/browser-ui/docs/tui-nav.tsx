import { lazy, Suspense } from 'react';
import { componentDocs } from './tui/catalog.js';
import { foundations } from './tui/foundations.js';
import { patternDocs } from './tui/patterns.js';

// Navigation stays available without loading the recorded terminal frames.
const TuiPageContent = lazy(() =>
  import('./tui/index.js').then((module) => ({ default: module.TuiPageContent })),
);
const LazyTuiMock = lazy(() =>
  import('./tui/index.js').then((module) => ({ default: module.TuiMock })),
);

const loading = <p data-scene-loading="">Loading preview…</p>;

export const tuiPages = [
  ...foundations.map(({ slug, title, lead }) => ({ slug, title, lead, group: 'Foundations' })),
  ...componentDocs.map(({ slug, title, lead }) => ({ slug, title, lead, group: 'Components' })),
  ...patternDocs.map(({ slug, title, lead }) => ({ slug, title, lead, group: 'Patterns' })),
].map((page) => ({
  ...page,
  render: () => (
    <Suspense fallback={loading}>
      <TuiPageContent slug={page.slug} />
    </Suspense>
  ),
}));

export function TuiMock({ path }: { path: string }) {
  return (
    <Suspense fallback={loading}>
      <LazyTuiMock path={path} />
    </Suspense>
  );
}
