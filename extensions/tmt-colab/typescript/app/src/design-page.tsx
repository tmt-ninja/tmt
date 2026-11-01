import { useEffect, useMemo, useRef, useState } from 'react';
import { mountRenderer, type RenderState } from './renderer.js';
import { pageDesignSystems } from './design-system-pages.js';
import type { PageSnapshot, PageTransport, PageView } from './transport.js';

/** Selected Design pages use Colab's existing opaque renderer and pinned-bundle resolver. */
export function DesignPage({ transport, pageId }: { transport: PageTransport; pageId: string }) {
  const [page, setPage] = useState<PageSnapshot & Pick<PageView, 'attachments'>>();
  const [error, setError] = useState<string>();
  const [state, setState] = useState<RenderState | 'loading'>('loading');
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<Awaited<ReturnType<typeof mountRenderer>> | null>(null);
  const images = useRef({
    binding: page?.binding?.files?.attachments,
    descriptors: page?.attachments ?? [],
  });
  images.current = {
    binding: page?.binding?.files?.attachments,
    descriptors: page?.attachments ?? [],
  };
  const source = page?.source;
  const layout = page?.layout;
  useEffect(() => {
    renderer.current?.images(images.current);
  }, [page?.attachments, page?.binding]);
  const designSystem = useMemo(() => pageDesignSystems(transport), [transport]);
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
  useEffect(() => {
    if (source === undefined || !host.current) return;
    const controller = new AbortController();
    let destroy: (() => void) | undefined;
    setState('loading');
    setError(undefined);
    void mountRenderer(host.current, source, {
      signal: controller.signal,
      layout,
      designSystem,
      images: images.current,
      onState: setState,
      viewportInset: () =>
        document.querySelector('.tmt-ui-shell-bar')?.getBoundingClientRect().bottom ?? 0,
    })
      .then((handle) => {
        if (controller.signal.aborted) handle.destroy();
        else {
          renderer.current = handle;
          handle.images(images.current);
          destroy = () => handle.destroy();
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      controller.abort();
      renderer.current = null;
      destroy?.();
    };
  }, [source, layout, designSystem]);
  return (
    <article className="design-page" aria-label={page?.title ?? 'Design page'}>
      {error && <p role="alert">{error}</p>}
      {!error && (!page || state === 'loading') && <p role="status">Loading design page…</p>}
      {!error && state === 'failed' && <p role="alert">The design page could not be rendered.</p>}
      <div className="design-page-renderer" ref={host} />
    </article>
  );
}
