import { createHash } from 'node:crypto';
import { expect, it } from 'vite-plus/test';
import vectors from '../../../contracts/vectors/block-attachments-v1.json';
import type { attachment } from '@tmt/colab-client';
import { AttachmentRefusal, admitAttachments } from '../src/blocks-attachments.js';
import type { BlockEntry } from '../src/blocks.js';

type Case = {
  name: string;
  source: string;
  setSource?: string;
  before: Record<string, unknown>;
  next: Record<string, unknown>;
  current: string[];
  set?: string[];
  remove?: string[];
  expect: { list?: string[] | null; refused?: 'attachment' | 'invalid' };
};

const sha256 = (source: string) => createHash('sha256').update(source, 'utf8').digest('hex');
const descriptor = (attachmentId: string, source: string) =>
  ({
    ...vectors.descriptor,
    attachmentId,
    source: { kind: 'document', sourceDigest: sha256(source) },
    signature: Buffer.alloc(64, 1).toString('base64url'),
  }) as attachment.AttachmentDescriptor;

it.each(vectors.cases as Case[])('$name', (item) => {
  const source = item.source;
  const current = item.current.map((id) => descriptor(id, source));
  const change =
    item.set || item.remove
      ? {
          ...(item.set
            ? { set: item.set.map((id) => descriptor(id, item.setSource ?? source)) }
            : {}),
          ...(item.remove ? { remove: item.remove } : {}),
        }
      : undefined;
  const run = () =>
    admitAttachments(
      item.before as Record<string, BlockEntry>,
      item.next as Record<string, BlockEntry>,
      current,
      change,
      sha256(source),
    );
  if (item.expect.refused) {
    expect(run).toThrow(AttachmentRefusal);
    try {
      run();
    } catch (error) {
      expect((error as AttachmentRefusal).reason).toBe(item.expect.refused);
    }
    return;
  }
  const list = run();
  expect(list?.map((d) => d.attachmentId) ?? null).toEqual(item.expect.list);
});
