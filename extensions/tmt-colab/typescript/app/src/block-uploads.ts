import { attachment } from '@tmt/colab-client';
import { attachmentFilename, RASTER_TYPES, storedMediaType } from './attachment-file.js';
import type { AttachmentInput, StoredAttachment } from './attachment-service.js';
import type { BlockType } from './block-model.js';
import { binarySize } from './strings.js';

/**
 * Files a person adds to a page of blocks (#6202): each is uploaded against the page's attachment
 * target and shown by a new image block (a raster image) or a file card (anything else); the
 * blocks and the page's attachment list change in one batch.
 */

/** What the editor adds files through: how many the page lists now, and one upload. */
export interface BlockFiles {
  count(): number;
  upload(input: AttachmentInput): Promise<StoredAttachment>;
}

/** Why a file is not added. */
export type BlockFileRefusal = 'empty' | 'too-large' | 'unreadable';

/** A picked file, read and checked: what is uploaded, and whether it draws as an image. */
export interface BlockFile {
  input: AttachmentInput;
  image: boolean;
}

/** Whether a page that lists `listed` files can take `adding` more (the descriptor cap). */
export const fitsAttachments = (listed: number, adding: number) =>
  listed + adding <= attachment.DOCUMENT_ATTACHMENTS;

/** Reads a picked file. Its bytes, not its name or the browser's declared type, decide what it is
 * (`storedMediaType`): a raster image draws as an image, anything else as a file card. */
export async function readBlockFile(file: File): Promise<BlockFile | BlockFileRefusal> {
  if (file.size === 0) return 'empty';
  if (file.size > attachment.ATTACHMENT_PLAINTEXT_BYTES) return 'too-large';
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return 'unreadable';
  }
  if (bytes.length === 0) return 'empty';
  if (bytes.length > attachment.ATTACHMENT_PLAINTEXT_BYTES) return 'too-large';
  const mediaType = storedMediaType(bytes);
  return {
    input: { filename: attachmentFilename(file.name), mediaType, bytes },
    image: (RASTER_TYPES as readonly string[]).includes(mediaType),
  };
}

/** The block that shows `file`: an image block of the stored attachment, or a file card. The
 * placeholder drawn while it uploads has no stored attachment yet. */
export function fileBlock(
  file: BlockFile,
  stored?: Pick<StoredAttachment, 'original'>,
): { type: BlockType; props: Record<string, unknown> } {
  const reference = `colab-attachment:${stored?.original.descriptor.attachmentId ?? '00000000'}`;
  const name = file.input.filename;
  if (file.image)
    return { type: 'image', props: { layout: 'single', images: [{ src: reference, alt: name }] } };
  return {
    type: 'image',
    props: {
      variant: 'file',
      files: [
        {
          name,
          size: binarySize(file.input.bytes.length),
          type: file.input.mediaType,
          ...(stored && { href: reference }),
        },
      ],
    },
  };
}
