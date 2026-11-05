import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
  type WheelEvent,
} from 'react';
import { FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, UiTheme } from '../ui/index.js';

export interface BlockImage {
  src: string;
  alt: string;
  caption?: string;
  tag?: string;
  status?: 'loading' | 'ready' | 'error';
  filename?: string;
  onRetry?(): void;
}
export interface BlockFile {
  name: string;
  size: string;
  type?: string;
  href?: string;
}
export interface ImageBlockProps {
  images: readonly BlockImage[];
  files?: readonly BlockFile[];
  variant?: 'image' | 'file';
  layout?: 'carousel' | 'grid' | 'single';
  size?: 's' | 'm' | 'l';
}

/** The caller supplies admitted attachment URLs and retry/download ownership. */
export function ImageBlock({
  images,
  files = [],
  variant = 'image',
  layout = 'carousel',
  size = 'm',
}: ImageBlockProps) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const opener = useRef<HTMLButtonElement>(null);
  const openerIndex = useRef(0);
  // Set when the viewer closes: the opener takes focus once the render that reveals it commits.
  const [restoreFocus, setRestoreFocus] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; distance?: number; zoom: number } | undefined>(
    undefined,
  );
  useEffect(() => {
    setIndex((previous) => Math.max(0, Math.min(previous, images.length - 1)));
    if (images.length === 0) setOpen(false);
  }, [images.length]);
  // After commit, not on a frame: a single-image layout shows the opener only once its index
  // has rendered, and a frame can run before that render commits (#5249).
  useLayoutEffect(() => {
    if (!restoreFocus) return;
    setRestoreFocus(false);
    opener.current?.focus();
  }, [restoreFocus, index]);
  const current = images[Math.min(index, images.length - 1)];
  const move = (delta: number) => {
    const next = Math.max(0, Math.min(images.length - 1, index + delta));
    setIndex(next);
    if (!open && layout === 'carousel') {
      const item = list.current?.children[next] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  const changeZoom = (next: number) => setZoom(Math.max(1, Math.min(4, next)));
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      changeZoom(zoom + 0.25);
    }
    if (event.key === '-') {
      event.preventDefault();
      changeZoom(zoom - 0.25);
    }
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    changeZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25));
  };
  const start = (event: TouchEvent) => {
    const first = event.touches[0];
    if (!first) return;
    const second = event.touches[1];
    gesture.current = {
      x: first.clientX,
      y: first.clientY,
      zoom,
      ...(second
        ? { distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY) }
        : {}),
    };
  };
  const touchMove = (event: TouchEvent) => {
    const first = event.touches[0],
      second = event.touches[1],
      initial = gesture.current;
    if (first && second && initial?.distance)
      changeZoom(
        (initial.zoom *
          Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)) /
          initial.distance,
      );
  };
  const end = (event: TouchEvent) => {
    const point = event.changedTouches[0],
      initial = gesture.current;
    if (!point || !initial || initial.distance) {
      gesture.current = undefined;
      return;
    }
    const dx = point.clientX - initial.x,
      dy = point.clientY - initial.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
    else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) setOpen(false);
    gesture.current = undefined;
  };
  const show = (at: number, button: HTMLButtonElement) => {
    opener.current = button;
    openerIndex.current = at;
    setIndex(at);
    setZoom(1);
    setOpen(true);
  };
  return (
    <UiTheme>
      <section
        className="tmt-block-images"
        data-layout={layout}
        data-size={size}
        role="region"
        aria-label={variant === 'file' ? 'Files' : 'Images'}
        aria-roledescription={variant === 'image' && layout === 'carousel' ? 'carousel' : undefined}
      >
        {variant === 'image' && (
          <>
            <div
              className="tmt-block-image-list"
              ref={list}
              onScroll={(event) => {
                if (layout !== 'carousel' || open) return;
                const element = event.currentTarget;
                let nearest = 0;
                let distance = Number.POSITIVE_INFINITY;
                for (const [at, child] of [...element.children].entries()) {
                  const offset = Math.abs(
                    child.getBoundingClientRect().left - element.getBoundingClientRect().left,
                  );
                  if (offset < distance) {
                    nearest = at;
                    distance = offset;
                  }
                }
                setIndex(nearest);
              }}
            >
              {images.map((image, at) => (
                <figure
                  key={`${image.src}-${at}`}
                  hidden={layout === 'single' && at !== index && !open}
                >
                  {!image.alt?.trim() ? (
                    <div role="alert">Image needs alt text.</div>
                  ) : image.status === 'error' || failed.has(image.src) ? (
                    <div role="alert">
                      ✗ Image failed to load{' '}
                      {image.onRetry && (
                        <button
                          type="button"
                          onClick={() => {
                            setFailed((old) => {
                              const next = new Set(old);
                              next.delete(image.src);
                              return next;
                            });
                            image.onRetry?.();
                          }}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={image.status === 'loading'}
                      aria-label={`Image ${at + 1}: open viewer`}
                      onClick={(event) => show(at, event.currentTarget)}
                    >
                      {image.status === 'loading' ? (
                        <span className="tmt-block-image-placeholder" />
                      ) : (
                        <img
                          src={image.src}
                          alt={image.alt}
                          onError={() => setFailed((old) => new Set(old).add(image.src))}
                        />
                      )}
                    </button>
                  )}
                  {(image.caption || image.tag) && (
                    <figcaption>
                      {image.caption} {image.tag}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
            {images.length > 1 && (
              <div className="tmt-block-image-controls">
                <button
                  type="button"
                  aria-label="Previous image"
                  disabled={index === 0}
                  onClick={() => move(-1)}
                >
                  ←
                </button>
                <span aria-live="polite">
                  {index + 1} / {images.length}
                </span>
                <button
                  type="button"
                  aria-label="Next image"
                  disabled={index >= images.length - 1}
                  onClick={() => move(1)}
                >
                  →
                </button>
                <span>{current?.caption}</span>
              </div>
            )}
          </>
        )}
        {files.map((file) => (
          <div className="tmt-block-file" key={file.name}>
            <FileText aria-hidden="true" />
            <span>{file.name}</span>
            <span>
              {file.type ? `${file.type} · ` : ''}
              {file.size}
            </span>
            {file.href && (
              <a href={file.href} download={file.name} aria-label={`Download ${file.name}`}>
                Download
              </a>
            )}
          </div>
        ))}
        {variant === 'image' && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              className="tmt-block-image-viewer"
              onKeyDown={keys}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (layout === 'single') setIndex(openerIndex.current);
                setRestoreFocus(true);
              }}
            >
              <DialogTitle>{current?.caption || current?.alt || 'Image viewer'}</DialogTitle>
              {current && (
                <div
                  className="tmt-block-image-viewer-canvas"
                  onWheel={wheel}
                  onTouchStart={start}
                  onTouchMove={touchMove}
                  onTouchEnd={end}
                >
                  <img
                    src={current.src}
                    alt={current.alt}
                    style={{ transform: `scale(${zoom})` }}
                  />
                </div>
              )}
              <div className="tmt-block-image-viewer-controls">
                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Previous image"
                      disabled={index === 0}
                      onClick={() => move(-1)}
                    >
                      ←
                    </button>
                    <span aria-live="polite">
                      {index + 1} / {images.length}
                    </span>
                    <button
                      type="button"
                      aria-label="Next image"
                      disabled={index >= images.length - 1}
                      onClick={() => move(1)}
                    >
                      →
                    </button>
                  </>
                )}
                <button
                  type="button"
                  aria-label="Zoom out"
                  disabled={zoom <= 1}
                  onClick={() => changeZoom(zoom - 0.25)}
                >
                  −
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  disabled={zoom >= 4}
                  onClick={() => changeZoom(zoom + 0.25)}
                >
                  +
                </button>
                {current?.src && (
                  <a
                    href={current.src}
                    download={current.filename || 'image'}
                    aria-label={`Download ${current.filename || 'image'}`}
                  >
                    Download
                  </a>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </section>
    </UiTheme>
  );
}
