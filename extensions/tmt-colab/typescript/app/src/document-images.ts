import type { attachment } from '@tmt/colab-client';
import type { AttachmentBinding } from './attachment-service.js';
import { RASTER_TYPES } from './attachment-file.js';
import { rasterDataUrl } from './attachment-raster.js';
import { readFailure } from './attachments.js';

export const IMAGE_BYTES = 64 * 1024 * 1024;
export const IMAGE_REFERENCES = 128;
/** Reads of one image while the page keeps moving under it. */
const CHANGED_READS = 3;
export const IMAGE_REFERENCE =
  /^colab-attachment:(?:[0-9a-f]{8}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;
export type ImageReason = 'unavailable' | 'unsupported' | 'not-here' | 'limit';
type ImageDisplay = { url: string } | { reason: ImageReason };
export type DocumentImage = { reference: string } & ImageDisplay;
export interface DocumentImageInput {
  binding?: AttachmentBinding;
  descriptors: readonly attachment.AttachmentDescriptor[];
}

/** One render's serial, bounded disclosure. Frame claims select only this page's
 * verified document list; they never supply a descriptor, URL or authority. */
export class DocumentImages {
  private readonly scope: string;
  private readonly cache = new Map<string, ImageDisplay>();
  private readonly seen = new Set<string>();
  private bytes = 0;
  private closed = false;
  private tail = Promise.resolve();
  constructor(
    private input: DocumentImageInput,
    private standing: () => boolean,
  ) {
    this.scope = input.binding?.scope?.() ?? '';
  }
  close(): void {
    this.closed = true;
    this.cache.clear();
  }
  private current(): boolean {
    return !this.closed && this.standing() && (this.input.binding?.scope?.() ?? '') === this.scope;
  }
  resolve(references: readonly string[], publish: (image: DocumentImage) => void): Promise<void> {
    this.tail = this.tail.then(async () => {
      for (const reference of references) {
        if (!this.current()) return;
        if (this.seen.has(reference) || this.seen.size >= IMAGE_REFERENCES) continue;
        this.seen.add(reference);
        const token = reference.slice('colab-attachment:'.length);
        const matches = this.input.descriptors.filter((d) =>
          token.length === 8 ? d.attachmentId.startsWith(token) : d.attachmentId === token,
        );
        let result: ImageDisplay = { reason: this.input.binding ? 'unavailable' : 'not-here' };
        const descriptor =
          IMAGE_REFERENCE.test(reference) && matches.length === 1 ? matches[0] : undefined;
        if (descriptor) {
          const cached = this.cache.get(descriptor.attachmentId);
          if (cached) result = cached;
          else if (!this.input.binding) result = { reason: 'not-here' };
          else if (!(RASTER_TYPES as readonly string[]).includes(descriptor.mediaType))
            result = { reason: 'unsupported' };
          else if (this.bytes + Number(descriptor.plaintextBytes) > IMAGE_BYTES)
            result = { reason: 'limit' };
          else {
            this.bytes += Number(descriptor.plaintextBytes);
            let bytes: Uint8Array | undefined;
            try {
              // A read names the page's revision when it starts; one that moves before the read is
              // admitted ('changed') is read again at the new revision, a bounded few times.
              for (let attempt = 1; ; attempt++) {
                try {
                  bytes = await this.input.binding.open({ kind: 'document' }, descriptor);
                  break;
                } catch (error) {
                  if (readFailure(error) !== 'changed' || attempt === CHANGED_READS) throw error;
                  if (!this.current()) return;
                }
              }
              if (!this.current()) return;
              result = { url: await rasterDataUrl(descriptor.mediaType, bytes) };
            } catch {
              result = { reason: 'unavailable' };
            } finally {
              bytes?.fill(0);
            }
          }
          if (this.current()) this.cache.set(descriptor.attachmentId, result);
        }
        if (this.current()) publish({ reference, ...result });
      }
    });
    return this.tail;
  }
}
