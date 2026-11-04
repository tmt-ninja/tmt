import { useLayoutEffect } from 'react';
import { previewRoot } from './preview.js';
import { tokenPages } from './tokens.js';

// The frame has one preview root. Keep it following the frame while any foundation is mounted.
let mounted = 0;

/** The same live foundation article used by the design-system docs. */
export function FoundationPage({ page }: { page: string }) {
  useLayoutEffect(() => {
    if (mounted++ === 0) previewRoot(document.documentElement);
    return () => {
      if (--mounted === 0) previewRoot(undefined);
    };
  }, []);
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
