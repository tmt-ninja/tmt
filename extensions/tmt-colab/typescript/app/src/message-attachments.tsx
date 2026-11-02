import { visibleElement } from './visible-element.js';
import { BrowserIconAction } from '@tmt/browser-ui/react';
import { Download } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { RASTER_TYPES } from './attachment-file.js';
import type { EchoAttachment } from './message-echo.js';
import type { DiscussionRef } from './thread-records.js';
import { isRaster, useAttachmentOpener } from './attachment-opener.js';
import { AttachmentPreview } from './attachment-preview.js';
import type { AttachmentBinding } from './attachment-service.js';
import { text } from './strings.js';
import { AttachmentLabel } from './attachment-tray.js';
import type { CommentView } from './thread-records.js';
import './attachment-tray.css';

/** Image elements a leaving tile hands to the tile that takes its place: a sent message's echo to
 * its recorded turn, or a tile to its own remount in the same read lifetime. The image stays drawn, so the row neither
 * blanks nor reloads (#5911). A hand-off nobody takes is dropped. */
const handed = new Map<string, HTMLImageElement>();
/** Tiles still waiting for an image: a record can mount before its echo leaves. */
const waiting = new Set<() => void>();
/** Which sent message an echo became, recorded when its write returns. */
const echoOf = new Map<string, string>();
const messageKey = (message: DiscussionRef) => JSON.stringify([message.writer, message.id]);
export function rememberEchoMessage(local: string, message: DiscussionRef) {
  echoOf.set(messageKey(message), local);
  setTimeout(() => echoOf.delete(messageKey(message)), 60_000);
}
const handoffKey = (owner: string, index: number, filename: string) =>
  JSON.stringify([owner, index, filename]);

function TileImage({
  url,
  failed,
  alt,
  handoff,
  fallback,
}: {
  url?: string;
  /** The tile's own read failed: an image it took is dropped, never shown in its place. */
  failed: boolean;
  alt: string;
  /** Where this tile's image is taken from when it mounts (the first key holding one) and
   * handed when it leaves (the first key). */
  handoff?: () => readonly string[];
  fallback: ReactNode;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const key = useRef(handoff);
  key.current = handoff;
  const [drawn, setDrawn] = useState(false);
  useLayoutEffect(() => {
    const take = () => {
      const at = key.current?.().find((value) => handed.has(value));
      if (at === undefined) return undefined;
      const taken = handed.get(at)!;
      handed.delete(at);
      return taken;
    };
    let img = take() ?? document.createElement('img');
    const adopt = () => {
      const taken = img.getAttribute('src') ? undefined : take();
      if (!taken && !img.getAttribute('src')) return;
      waiting.delete(adopt);
      if (!taken) return;
      taken.alt = img.alt;
      img = image.current = taken;
      host.current!.append(img);
      setDrawn(true);
    };
    image.current = img;
    // An image enters the page only once it has a source: a tile still reading shows none.
    if (img.getAttribute('src')) host.current!.append(img);
    setDrawn(!!img.getAttribute('src'));
    if (!img.getAttribute('src')) waiting.add(adopt);
    return () => {
      waiting.delete(adopt);
      img.remove();
      const to = key.current?.()[0];
      if (to === undefined || !img.getAttribute('src')) return;
      handed.set(to, img);
      for (const wake of waiting) wake();
      setTimeout(() => {
        if (handed.get(to) === img) handed.delete(to);
      }, 30_000);
    };
  }, []);
  useLayoutEffect(() => {
    const img = image.current!;
    img.alt = alt;
    if (failed) {
      img.remove();
      img.removeAttribute('src');
      setDrawn(false);
    } else if (url && img.getAttribute('src') !== url) {
      img.src = url;
      host.current!.append(img);
      setDrawn(true);
    }
  }, [url, failed, alt]);
  return (
    <>
      <span ref={host} className="attachment-image" hidden={!drawn} />
      {!drawn && fallback}
    </>
  );
}

/** Visibility admits only the displayed tile, never a hidden overflow image. The read
 * owner retains the verified display copy when a tile scrolls away and returns. */
function ImageTile({
  item,
  url,
  error,
  load,
  open,
  single,
  handoff,
}: {
  item: { filename: string; mediaType: string; size: number };
  url?: string;
  error?: string;
  load?(visible: () => boolean): void;
  open?(trigger: HTMLElement): void;
  single: boolean;
  handoff?: () => readonly string[];
}) {
  const tile = useRef<HTMLButtonElement>(null);
  const visible = useRef(false);
  const read = useRef(load);
  read.current = load;
  useEffect(() => {
    if (!read.current) return;
    const observer = new IntersectionObserver((entries) => {
      visible.current = entries.some((entry) => entry.isIntersecting);
      if (visible.current) read.current?.(() => visible.current && visibleElement(tile.current));
    });
    observer.observe(tile.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <li className="message-attachment message-image" data-testid="message-attachment">
      <AttachmentLabel filename={item.filename} mediaType={item.mediaType} size={item.size} />
      <button
        ref={tile}
        disabled={!open}
        type="button"
        className={single ? 'attachment-thumbnail single' : 'attachment-thumbnail'}
        aria-label={`Preview ${item.filename}`}
        title={item.filename}
        onClick={(event) => {
          if (event.isTrusted) open?.(event.currentTarget);
        }}
      >
        <TileImage
          url={url}
          failed={!!error}
          alt={item.filename}
          handoff={handoff}
          fallback={<span>{error ?? text.attachmentOpening}</span>}
        />
      </button>
      {error && (
        <span className="attachment-state" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}

/** One layout for pending display copies and admitted message tiles. */
function AttachmentTiles({
  images,
  files,
  more,
  notice,
  children,
}: {
  images: ReactNode[];
  files: ReactNode[];
  more?(trigger: HTMLElement): void;
  notice?: ReactNode;
  children?: ReactNode;
}) {
  if (!images.length && !files.length) return children ?? null;
  return (
    <div
      className="message-attachments"
      aria-label={text.messageAttachmentsLabel}
      data-testid="message-attachments"
    >
      {notice}
      {!!images.length && (
        <ul className={images.length === 1 ? 'attachment-images single' : 'attachment-images'}>
          {images.length > 6 ? images.slice(0, 5) : images}
          {images.length > 6 && (
            <li>
              <button
                type="button"
                className="attachment-thumbnail attachment-more"
                aria-label={`Show ${images.length - 5} more images`}
                disabled={!more}
                onClick={(event) => {
                  if (event.isTrusted) more?.(event.currentTarget);
                }}
              >
                +{images.length - 5}
              </button>
            </li>
          )}
        </ul>
      )}
      {!!files.length && <ul className="attachment-files">{files}</ul>}
      {children}
    </div>
  );
}

function FileTile({
  item,
  disabled = false,
  download,
  error,
}: {
  item: { filename: string; mediaType: string; size: number };
  disabled?: boolean;
  download?(): void;
  error?: string;
}) {
  return (
    <li className="message-attachment message-file" data-testid="message-attachment">
      <AttachmentLabel filename={item.filename} mediaType={item.mediaType} size={item.size} />
      <BrowserIconAction
        type="button"
        variant="text"
        label={text.attachmentDownload}
        icon={<Download />}
        disabled={disabled || !download}
        aria-disabled={disabled || !download || undefined}
        onActivate={(event) => {
          if (event.isTrusted) download?.();
        }}
      />
      {error && (
        <span className="attachment-state" role="alert">
          ✗ {error}
        </span>
      )}
    </li>
  );
}

function EchoImage({
  item,
  single,
  handoff,
}: {
  item: EchoAttachment;
  single: boolean;
  handoff: () => readonly string[];
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let current = true;
    void item.preview.then((value) => {
      if (current) setUrl(value);
    });
    return () => {
      current = false;
    };
  }, [item]);
  return <ImageTile item={item} single={single} url={url} handoff={handoff} />;
}

/** Local display only, with no remote read or attachment actions. The failed row keeps
 * these captured tiles while its composer owns the retryable draft. */
export function EchoAttachments({
  attachments,
  local,
}: {
  attachments: readonly EchoAttachment[];
  /** The echo's own ID: its recorded turn takes these images under it when the echo leaves. */
  local: string;
}) {
  const images = attachments.filter((item) => RASTER_TYPES.some((type) => type === item.mediaType));
  const files = attachments.filter((item) => !RASTER_TYPES.some((type) => type === item.mediaType));
  return (
    <AttachmentTiles
      images={images.map((item, index) => (
        <EchoImage
          key={item.id}
          item={item}
          single={images.length === 1}
          handoff={() => [handoffKey(local, index, item.filename)]}
        />
      ))}
      files={files.map((item) => (
        <FileTile key={item.id} item={item} />
      ))}
    />
  );
}

/** Shared by Chat and thread turns. All remote bytes still cross the exact admitted
 * message-reference read; filenames are inert labels and raster types are rechecked. */
export function MessageAttachments({
  comment,
  binding,
}: {
  comment: CommentView;
  binding?: AttachmentBinding;
}) {
  const descriptors = comment.attachments ?? [];
  const reference = {
    kind: 'message',
    writer: comment.ref.writer,
    messageId: comment.messageId,
    revision: comment.revision,
  } as const;
  const referenceKey = JSON.stringify([reference, descriptors]);
  const opener = useAttachmentOpener(binding, reference, descriptors);
  const images = descriptors.filter(isRaster);
  const files = descriptors.filter((d) => !isRaster(d));
  const [viewer, setViewer] = useState<{ index: number; trigger: HTMLElement; lifetime: object }>();
  const active = viewer?.lifetime === opener.lifetime ? viewer : undefined;
  const show = (index: number, trigger: HTMLElement) => {
    void opener.preview(images[index]);
    setViewer({ index, trigger, lifetime: opener.lifetime });
  };
  if (!descriptors.length)
    return opener.unlistedFailure ? <p role="alert">{text.attachmentReason.changed}</p> : null;
  const error = (id: string) => {
    const failure = opener.failed.get(id);
    return failure ? text.attachmentReason[failure] : undefined;
  };
  return (
    <AttachmentTiles
      images={images.map((d, index) => (
        <ImageTile
          key={`${referenceKey}:${d.attachmentId}:${opener.lifetime.generation}`}
          item={{ filename: d.filename, mediaType: d.mediaType, size: Number(d.plaintextBytes) }}
          single={images.length === 1}
          url={opener.shown[d.attachmentId]}
          error={error(d.attachmentId)}
          load={(visible) => {
            void opener.thumbnail(d, visible);
          }}
          open={(trigger) => show(index, trigger)}
          handoff={() => {
            const message = messageKey({ writer: comment.ref.writer, id: comment.messageId });
            const echo = echoOf.get(message);
            // A new read lifetime never takes the old one's image: it is disposed and read again.
            return [
              handoffKey(`${message}:${opener.lifetime.generation}`, index, d.filename),
              ...(echo ? [handoffKey(echo, index, d.filename)] : []),
            ];
          }}
        />
      ))}
      files={files.map((d) => (
        <FileTile
          key={d.attachmentId}
          item={{ filename: d.filename, mediaType: d.mediaType, size: Number(d.plaintextBytes) }}
          disabled={!binding || !!opener.busy}
          download={() => {
            void opener.download(d);
          }}
          error={error(d.attachmentId)}
        />
      ))}
      more={(trigger) => show(5, trigger)}
      notice={opener.unlistedFailure && <p role="alert">{text.attachmentReason.changed}</p>}
    >
      {active && (
        <AttachmentPreview
          images={images}
          index={active.index}
          trigger={active.trigger}
          url={opener.shown[images[active.index].attachmentId]}
          error={error(images[active.index].attachmentId)}
          select={(index) => show(index, active.trigger)}
          close={() => setViewer(undefined)}
          download={() => {
            void opener.download(images[active.index]);
          }}
        />
      )}
    </AttachmentTiles>
  );
}
