import { BrowserAction } from '@tmt/browser-ui/react';
import type { attachment } from '@tmt/colab-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachmentBinding } from './attachment-service.js';
import { useAttachmentOpener } from './attachment-opener.js';
import { downloadCooldown } from './download-cooldown.js';
import { BlobDownloads } from './export.js';
import { imageBytes, type ImageDownload } from './image-download.js';
import { text } from './strings.js';
import './page-link-bar.css';

/** What the bar asks about: a current-page attachment, or a `data:` image the frame handed over. */
type Pending = { kind: 'attachment'; id: string } | { kind: 'image'; image: ImageDownload };

/** A frame may ask, but only this parent confirmation grants a download: of a current attachment,
 * or of a page image the parent has already checked (#5981). */
export function usePageAttachmentDownload(
  binding: AttachmentBinding | undefined,
  descriptors: readonly attachment.AttachmentDescriptor[],
  inset: () => number,
) {
  const opener = useAttachmentOpener(binding, { kind: 'document' }, descriptors);
  const [pending, setPending] = useState<Pending>();
  const [settled, setSettled] = useState(false);
  const generation = useRef(0);
  const [cooldown] = useState(downloadCooldown);
  // Whether the bar is asking, read by the request and close paths without waiting for a render.
  const open = useRef(false);
  const known = useRef(descriptors);
  known.current = descriptors;
  const saves = useRef<BlobDownloads | null>(null);
  useEffect(() => {
    const owner = new BlobDownloads();
    saves.current = owner;
    return () => {
      saves.current = null;
      owner.close();
    };
  }, []);
  const close = useCallback(() => {
    generation.current += 1;
    open.current = false;
    setSettled(false);
    setPending(undefined);
  }, []);
  // A Cancel (the button, Escape or a light dismiss) starts the cool-down (#6094).
  const cancel = useCallback(() => {
    if (open.current) cooldown.cancelled();
    close();
  }, [close, cooldown]);
  // A new render or page: nothing pending, and the frame may ask again at once.
  const reset = useCallback(() => {
    cooldown.clear();
    close();
  }, [close, cooldown]);
  const ask = (next: Pending) => {
    // One request at a time: while the bar asks, and during the cool-down, the frame is ignored.
    if (open.current || !cooldown.admits()) return;
    generation.current += 1;
    open.current = true;
    setSettled(false);
    setPending(next);
  };
  const item =
    pending?.kind === 'attachment'
      ? descriptors.find((descriptor) => descriptor.attachmentId === pending.id)
      : undefined;
  const image = pending?.kind === 'image' ? pending.image : undefined;
  const shown = image ? 'image' : item && binding ? item.attachmentId : undefined;
  const failure = item ? opener.failed.get(item.attachmentId) : undefined;
  const root = useRef<HTMLDivElement>(null);
  const top = useRef(inset);
  top.current = inset;
  useEffect(() => {
    const node = root.current;
    if (!node || !shown) return;
    node.style.top = `${Math.max(0, top.current())}px`;
    node.showPopover();
    node.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (node.matches(':popover-open')) node.hidePopover();
    };
  }, [shown, pending]);
  useEffect(() => {
    if (settled && !failure) close();
  }, [close, failure, settled]);
  // A request the bar cannot show (an attachment no longer on the page) holds nothing open.
  useEffect(() => {
    if (pending && !shown) close();
  }, [close, pending, shown]);
  return {
    request: (id: string) => {
      if (known.current.some((descriptor) => descriptor.attachmentId === id) && binding)
        ask({ kind: 'attachment', id });
    },
    requestImage: (next: ImageDownload) => ask({ kind: 'image', image: next }),
    reset,
    bar: shown ? (
      <div
        ref={root}
        popover="auto"
        role="dialog"
        aria-label={image ? 'Download image' : 'Download attachment'}
        className="page-link-bar"
        onToggle={(event) => {
          if (event.newState === 'closed' && open.current) cancel();
        }}
      >
        <h2>{image ? 'Download image?' : 'Download attachment?'}</h2>
        {/* The frame's name is plain text here, already cut and cleaned; never a path. */}
        <p>{image ? image.filename : item?.filename}</p>
        {failure && settled && <p role="alert">{text.attachmentReason[failure]}</p>}
        <BrowserAction type="button" variant="ghost" label="Cancel" onActivate={cancel} />
        <BrowserAction
          type="button"
          variant="primary"
          label="Download"
          disabled={!!item && opener.busy === item.attachmentId}
          onActivate={(event) => {
            if (!event.isTrusted) return;
            if (image) {
              saves.current?.request(
                new Blob([new Uint8Array(imageBytes(image))], { type: 'application/octet-stream' }),
                image.filename,
              );
              close();
              return;
            }
            if (!item) return;
            const current = ++generation.current;
            setSettled(false);
            void opener.download(item).then(() => {
              if (generation.current === current) setSettled(true);
            });
          }}
        />
      </div>
    ) : null,
  };
}
