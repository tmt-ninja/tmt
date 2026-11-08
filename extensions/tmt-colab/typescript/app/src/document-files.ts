import type { attachment } from '@tmt/colab-client';
import type {
  AttachmentBinding,
  AttachmentService,
  AttachmentTarget,
  StoredAttachment,
} from './attachment-service.js';
import type { OwnRecord } from './fold-protocol.js';
import type { BlockOp } from './block-model.js';
import type { BlocksOutcome } from './transport.js';

/** The page's own files: uploads bound to the current source, published as an `intents` proof
 * first and then written into the document through Save, so a changed page never attaches. */
export interface DocumentFiles {
  /** Uploads and authorized reads over the page's object channel. */
  readonly attachments: AttachmentBinding;
  /** The page's current epoch: a file sealed under an earlier one waits to be re-sealed. */
  readonly epoch: string;
  /** The upload target now: the exact source a new file is bound to. */
  target(): AttachmentTarget;
  /** Prove, then write, uploaded files into the page; a changed page is a stale error. */
  add(stored: readonly StoredAttachment[]): Promise<void>;
  /** Remove references; the stored bytes go 30 days after no page refers to them. */
  remove(attachmentIds: readonly string[]): Promise<void>;
  /** A page of blocks (#6202): prove the uploaded files, then add them to the page's list in the
   * same block batch as `ops` (the blocks that show them). */
  addToBlocks?(
    stored: readonly StoredAttachment[],
    ops: readonly BlockOp[],
  ): Promise<BlocksOutcome>;
}

export interface DocumentFilesOptions {
  service: AttachmentService;
  /** The page's current epoch. */
  epoch(): string;
  /** The admitted source a save is based on. */
  source(): string;
  publish(records: OwnRecord[]): Promise<void>;
  edit(source: string, base: string, change: attachment.DocumentChange): Promise<unknown>;
  /** A block batch with an attachment change, on a page of blocks. */
  blocks?(ops: readonly BlockOp[], change: attachment.DocumentChange): Promise<BlocksOutcome>;
}

export class LiveDocumentFiles implements DocumentFiles {
  constructor(private options: DocumentFilesOptions) {}
  get attachments() {
    return this.options.service;
  }
  get epoch() {
    return this.options.epoch();
  }
  target(): AttachmentTarget {
    return { kind: 'document', source: this.options.source() };
  }
  async add(stored: readonly StoredAttachment[]) {
    if (!stored.length) return;
    const source = this.options.source();
    await this.options.publish(await this.options.service.publication(stored, source));
    await this.options.edit(source, source, {
      set: stored.map(({ original }) => original.descriptor),
    });
  }
  async addToBlocks(stored: readonly StoredAttachment[], ops: readonly BlockOp[]) {
    const blocks = this.options.blocks;
    if (!blocks) throw new Error('This page holds no blocks.');
    const source = this.options.source();
    await this.options.publish(await this.options.service.publication(stored, source));
    return blocks(ops, { set: stored.map(({ original }) => original.descriptor) });
  }
  async remove(attachmentIds: readonly string[]) {
    if (!attachmentIds.length) return;
    const source = this.options.source();
    await this.options.edit(source, source, { remove: [...attachmentIds] });
  }
}
