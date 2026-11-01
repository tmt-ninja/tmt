import { useEffect, useMemo, useRef, useState } from 'react';
import { mountRenderer, type RenderState } from './renderer.js';
import { pageDesignSystems } from './design-system-pages.js';
import type { DocumentImageInput } from './document-images.js';
import type { PageTransport } from './transport.js';
import type { PageLayout } from './page-layout.js';

/** A stored page and each live example share the real opaque renderer and verified bundle resolver. */
export function DesignFrame({
  transport,
  source,
  title,
  images,
  layout,
  preview = false,
}: {
  transport: PageTransport;
  source: string;
  title: string;
  images: DocumentImageInput;
  layout?: PageLayout;
  preview?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<Awaited<ReturnType<typeof mountRenderer>> | null>(null);
  const currentImages = useRef(images);
  currentImages.current = images;
  const [state, setState] = useState<RenderState | 'loading'>('loading');
  const [error, setError] = useState<string>();
  const designSystem = useMemo(() => pageDesignSystems(transport), [transport]);
  useEffect(() => {
    handle.current?.images(images);
  }, [images]);
  useEffect(() => {
    if (!host.current) return;
    const controller = new AbortController();
    let destroy: (() => void) | undefined;
    setState('loading');
    setError(undefined);
    void mountRenderer(host.current, source, {
      signal: controller.signal,
      layout,
      designSystem,
      images: currentImages.current,
      onState: setState,
      viewportInset: () => {
        const canvas = preview ? host.current?.closest('.docs-canvas') : null;
        if (canvas) {
          // The docs canvas, not the reader viewport, owns an example's minimum height.
          const style = getComputedStyle(canvas);
          const minimum =
            (parseFloat(style.minHeight) || 0) -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom) -
            parseFloat(style.borderTopWidth) -
            parseFloat(style.borderBottomWidth);
          return window.innerHeight - Math.max(1, minimum);
        }
        return document.querySelector('.tmt-ui-shell-bar')?.getBoundingClientRect().bottom ?? 0;
      },
    })
      .then((renderer) => {
        if (controller.signal.aborted) renderer.destroy();
        else {
          handle.current = renderer;
          renderer.images(currentImages.current);
          destroy = () => renderer.destroy();
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      controller.abort();
      handle.current = null;
      destroy?.();
    };
  }, [source, layout, designSystem, preview]);
  return (
    <div className="design-live-frame" aria-label={title}>
      {error && <p role="alert">{error}</p>}
      {!error && state === 'loading' && <p role="status">Loading design preview…</p>}
      {!error && state === 'failed' && (
        <p role="alert">The design preview could not be rendered.</p>
      )}
      <div className="design-page-renderer" ref={host} />
    </div>
  );
}
