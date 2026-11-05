/**
 * A page frame's request to download an image that is page data rather than an attachment: the
 * `data:` image in an image block's viewer (#5981). The frame cannot download (its sandbox has no
 * `allow-downloads`), so it asks the parent, which admits only a bounded raster image whose bytes
 * are what the URL says, and saves it only on the reader's trusted confirmation.
 */

/** The largest decoded image a frame may hand over: the page source cap. */
export const IMAGE_DOWNLOAD_BYTES = 2 * 1024 * 1024;
/** The longest `src` the parent reads at all: the base64 of the largest image and its prefix. */
export const IMAGE_DOWNLOAD_SOURCE = Math.ceil(IMAGE_DOWNLOAD_BYTES / 3) * 4 + 64;
const FILENAME_LENGTH = 128;

/** The raster types a frame may hand over, with the leading bytes each must start with. SVG is
 * not one: it is markup, not an image to save. */
const TYPES = {
  'image/png': {
    ext: 'png',
    matches: (b: Uint8Array) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  'image/jpeg': { ext: 'jpg', matches: (b: Uint8Array) => starts(b, [0xff, 0xd8, 0xff]) },
  'image/gif': {
    ext: 'gif',
    matches: (b: Uint8Array) =>
      starts(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  },
  'image/webp': {
    ext: 'webp',
    matches: (b: Uint8Array) =>
      starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
} as const;
type ImageType = keyof typeof TYPES;
const starts = (bytes: Uint8Array, prefix: readonly number[]) =>
  prefix.every((value, index) => bytes[index] === value);

/** An admitted request: what the bar shows and what a confirmed download saves. */
export interface ImageDownload {
  readonly mediaType: ImageType;
  /** Plain text for the bar and the saved file's name; never a path. */
  readonly filename: string;
  /** The decoded size, counted from the base64 before anything is decoded. */
  readonly length: number;
  readonly base64: string;
}

const SOURCE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/;

/** The request when it is a bounded raster `data:` image whose bytes match its type; else none. */
export function admitImageDownload(src: unknown, filename: unknown): ImageDownload | undefined {
  if (typeof src !== 'string' || typeof filename !== 'string') return undefined;
  if (src.length > IMAGE_DOWNLOAD_SOURCE) return undefined;
  const match = SOURCE.exec(src);
  if (!match) return undefined;
  const mediaType = match[1] as ImageType;
  const base64 = match[2]!;
  if (base64.length === 0 || base64.length % 4 !== 0) return undefined;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const length = (base64.length / 4) * 3 - padding;
  if (length > IMAGE_DOWNLOAD_BYTES) return undefined;
  // Only the first 12 bytes are decoded to check the type.
  if (!TYPES[mediaType].matches(decode(base64.slice(0, 16)))) return undefined;
  return { mediaType, filename: safeFilename(filename, TYPES[mediaType].ext), length, base64 };
}

/** The image's bytes, decoded only for a confirmed download. */
export function imageBytes(image: ImageDownload): Uint8Array {
  return decode(image.base64);
}

function decode(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes;
}

const PATH = '/\\:*?"<>|';
/** Control characters (C0, DEL, C1) and the marks and overrides that reorder how text reads. */
const removed = (code: number) =>
  code < 0x20 ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0x200e ||
  code === 0x200f ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);
/**
 * The frame's name as plain text: no control, direction-override or path characters, no leading dots, at most 128
 * characters, ending in the verified type's extension (added when it ends in any other);
 * `image.<ext>` when nothing is left.
 */
export function safeFilename(name: string, ext: string): string {
  const cleaned = [...name.normalize('NFC')]
    .filter((character) => !removed(character.codePointAt(0)!) && !PATH.includes(character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '');
  const cut = [...cleaned].slice(0, FILENAME_LENGTH).join('').trimEnd();
  if (!cut) return `image.${ext}`;
  const own = /\.([A-Za-z0-9]{1,5})$/.exec(cut)?.[1]?.toLowerCase();
  if (own === ext || (ext === 'jpg' && own === 'jpeg')) return cut;
  return `${[...cut].slice(0, FILENAME_LENGTH - ext.length - 1).join('')}.${ext}`;
}
