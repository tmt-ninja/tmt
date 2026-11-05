import { useLayoutEffect } from 'react';
import { previewRoot, usePreview } from './preview.js';
import { tokenPages } from './tokens.js';

// The frame has one preview root. Keep it following the frame while any foundation is mounted.
let mounted = 0;

/** Follow the frame's theme while at least one live documentation page is mounted. */
export function useFramePreview() {
  useLayoutEffect(() => {
    if (mounted++ === 0) previewRoot(document.documentElement);
    return () => {
      if (--mounted === 0) previewRoot(undefined);
    };
  }, []);
  return usePreview();
}

/** The same live foundation article used by the design-system docs. */
export function FoundationPage({ page }: { page: string }) {
  useFramePreview();
  const doc = tokenPages.find((entry) => entry.slug === page);
  if (!doc) return null;
  const Content = doc.render;
  return (
    <article className="docs-article">
      <h1>{doc.title}</h1>
      <p className="docs-lead">{doc.lead}</p>
      <Content />
    </article>
  );
}
