import { lazy, Suspense, useEffect, useState } from 'react';
import type { DesignSystemEntry } from './design-system-pages.js';
const DesignPageDocs = lazy(() =>
  import('./design-page-docs.js').then((module) => ({ default: module.DesignPageDocs })),
);
import type { PageSnapshot, PageTransport, PageView } from './transport.js';

/** Selected Design pages use Colab's existing opaque renderer and pinned-bundle resolver. */
export function DesignPage({
  transport,
  pageId,
  system,
  navigate,
}: {
  transport: PageTransport;
  pageId: string;
  system: DesignSystemEntry;
  navigate(href: string): void;
}) {
  const [page, setPage] = useState<PageSnapshot & Pick<PageView, 'attachments'>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    let close: (() => void) | undefined;
    setPage(undefined);
    setError(undefined);
    void transport
      .page(pageId, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) {
          snapshot.binding?.close();
          return;
        }
        setPage(snapshot);
        const unsubscribe = snapshot.binding?.subscribe(
          (view) => setPage({ ...snapshot, ...view }),
          (failure) => setError(failure.message),
        );
        close = () => {
          unsubscribe?.();
          snapshot.binding?.close();
        };
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      controller.abort();
      close?.();
    };
  }, [transport, pageId]);
  if (error) return <p role="alert">{error}</p>;
  if (!page) return <p role="status">Loading design page…</p>;
  return (
    <Suspense fallback={<p role="status">Loading design documentation…</p>}>
      <DesignPageDocs transport={transport} page={page} system={system} navigate={navigate} />
    </Suspense>
  );
}
