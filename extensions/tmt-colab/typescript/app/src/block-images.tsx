import { type BlockFile, type BlockImage, ImageBlock } from '@tmt/browser-ui/blocks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BlockRecord } from './block-model.js';
import type { BlockUpload } from './use-block-editing.js';
import {
  type DocumentImage,
  type DocumentImageInput,
  DocumentImages,
  IMAGE_REFERENCE,
} from './document-images.js';

/** The image block's layouts and sizes, as the validator takes them. */
const LAYOUTS = ['carousel', 'grid', 'single'] as const;
const SIZES = ['s', 'm', 'l'] as const;

/** One image of an image block, read from its untrusted props as plain values. */
export interface BlockImageSpec {
  reference: string;
  alt: string;
  caption?: string;
  tag?: string;
  filename?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** An image block's images and its validated layout and size (#6005 image step). Only a
 * `colab-attachment:` source is ever resolved; any other source (an `https:` one the serve admits
 * for agents) is drawn in its error state, never fetched. */
export function blockImages(block: BlockRecord): {
  images: BlockImageSpec[];
  files: BlockFile[];
  variant: 'image' | 'file';
  layout: (typeof LAYOUTS)[number];
  size: (typeof SIZES)[number];
} {
  const list = Array.isArray(block.props.images) ? block.props.images.slice(0, 100) : [];
  const images = list.flatMap((item): BlockImageSpec[] => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const reference = text(value.src);
    if (reference === undefined) return [];
    const caption = text(value.caption);
    const tag = text(value.tag);
    const filename = text(value.filename);
    return [
      {
        reference,
        // An agent may leave out alt text; the caption or the file's name stands in for it.
        alt: text(value.alt)?.trim() || caption || filename || 'Image',
        ...(caption && { caption }),
        ...(tag && { tag }),
        ...(filename && { filename }),
      },
    ];
  });
  // A file card (#6202) names its file; its reference is never handed to the part, which would draw
  // it as a plain link (the page's files are read only through the authorized path).
  const files = (Array.isArray(block.props.files) ? block.props.files.slice(0, 100) : []).flatMap(
    (item): BlockFile[] => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      const name = text(value.name);
      if (!name) return [];
      const type = text(value.type);
      return [{ name, size: text(value.size) ?? '', ...(type && { type }) }];
    },
  );
  return {
    images,
    files,
    variant: block.props.variant === 'file' ? 'file' : 'image',
    layout: LAYOUTS.find((value) => value === block.props.layout) ?? 'carousel',
    size: SIZES.find((value) => value === block.props.size) ?? 'm',
  };
}

/** Whether `reference` names exactly one file of the page's verified list (an 8-digit prefix or a
 * full ID), as the read resolves it. */
export function holds(
  reference: string,
  descriptors: DocumentImageInput['descriptors'] | undefined,
): boolean {
  if (!IMAGE_REFERENCE.test(reference)) return false;
  const token = reference.slice('colab-attachment:'.length);
  return (
    (descriptors ?? []).filter((d) =>
      token.length === 8 ? d.attachmentId.startsWith(token) : d.attachmentId === token,
    ).length === 1
  );
}

/**
 * The page's `colab-attachment:` images, through the same authorized, bounded read as an HTML
 * page's images (`DocumentImages`: this page's verified attachment list, raster types only, a byte
 * budget). Only references the page holds are read; `retry` reads a failed one again. Without a
 * source (a reader with no attachment access) nothing is read.
 */
export function useBlockImages(
  source: DocumentImageInput | undefined,
  references: readonly string[],
): { found: ReadonlyMap<string, DocumentImage>; retry(reference: string): void } {
  const [found, setFound] = useState<ReadonlyMap<string, DocumentImage>>(new Map());
  const [attempt, setAttempt] = useState(0);
  const descriptors = JSON.stringify(source?.descriptors ?? []);
  const wanted = useMemo(
    () => [...new Set(references.filter((reference) => holds(reference, source?.descriptors)))],
    // The list's contents, not its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [references.join('\n'), descriptors],
  );
  const scope = source?.binding?.scope?.();
  useEffect(() => {
    if (!source || !wanted.length) return;
    let standing = true;
    const images = new DocumentImages(source, () => standing);
    void images.resolve(wanted, (image) =>
      setFound((now) => new Map(now).set(image.reference, image)),
    );
    return () => {
      standing = false;
      images.close();
    };
    // A new list, scope, set of references or a retry reads again; the source object itself may
    // be new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, descriptors, scope, source?.binding, attempt]);
  const retry = useCallback((reference: string) => {
    setFound((now) => {
      const next = new Map(now);
      next.delete(reference);
      return next;
    });
    setAttempt((n) => n + 1);
  }, []);
  return { found, retry };
}

/** The honest copy of a tile the page does not draw. */
const NOTICES = {
  outside: 'Image not shown on this page',
  missing: 'File not found',
  unsupported: 'Not an image',
  limit: 'Too many images to show here',
  'not-here': 'Image not available here',
} as const;

/**
 * What the DS image part draws for one image (#6005 image step, the spec's states): the read
 * image; the grey tile while it is read; `× Failed to load` with Retry when the read failed; and a
 * not-found tile, never fetched, for a reference the page does not hold or any other source.
 */
export function drawnImage(
  spec: BlockImageSpec,
  found: ReadonlyMap<string, DocumentImage>,
  source: DocumentImageInput | undefined,
  retry?: (reference: string) => void,
): BlockImage {
  const base = {
    src: '',
    alt: spec.alt,
    ...(spec.caption && { caption: spec.caption }),
    ...(spec.tag && { tag: spec.tag }),
    ...(spec.filename && { filename: spec.filename }),
  };
  const notFound = (notice: string): BlockImage => ({ ...base, status: 'not-found', notice });
  if (!IMAGE_REFERENCE.test(spec.reference)) return notFound(NOTICES.outside);
  if (!holds(spec.reference, source?.descriptors)) return notFound(NOTICES.missing);
  if (!source?.binding) return notFound(NOTICES['not-here']);
  const image = found.get(spec.reference);
  if (!image) return { ...base, status: 'loading' };
  if ('url' in image) return { ...base, src: image.url, status: 'ready' };
  if (image.reason === 'unavailable')
    return {
      ...base,
      status: 'error',
      ...(retry && { onRetry: () => retry(spec.reference) }),
    };
  return notFound(NOTICES[image.reason]);
}

/** An image block: its attachments read through the page's authorized path, drawn by DS
 * `ImageBlock`, each unreadable one in its error state. */
export function StructuredImages({
  block,
  source,
  upload,
}: {
  block: BlockRecord;
  source?: DocumentImageInput;
  /** This tab is adding the block's file (#6202): its tile while it uploads, or failed. */
  upload?: BlockUpload;
}) {
  const { images, files, variant, layout, size } = useMemo(() => blockImages(block), [block]);
  const { found, retry } = useBlockImages(
    source,
    upload ? [] : images.map((image) => image.reference),
  );
  if (upload) {
    // The spec's grey tile while the file uploads, then `× Failed to load` with Retry.
    const alt = images[0]?.alt ?? files[0]?.name ?? 'File';
    return (
      <ImageBlock
        images={[
          upload.state === 'loading'
            ? { src: '', alt, status: 'loading' }
            : { src: '', alt, status: 'error', onRetry: upload.retry },
        ]}
        layout="single"
        size={size}
      />
    );
  }
  return (
    <ImageBlock
      images={
        variant === 'file' ? [] : images.map((image) => drawnImage(image, found, source, retry))
      }
      files={files}
      variant={variant}
      layout={layout}
      size={size}
    />
  );
}
