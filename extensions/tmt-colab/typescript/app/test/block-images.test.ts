import { describe, expect, it } from 'vite-plus/test';
import { blockImages, drawnImage } from '../src/block-images.js';
import type { BlockRecord } from '../src/block-model.js';

const block = (props: Record<string, unknown>): BlockRecord => ({
  id: 'i',
  type: 'image',
  parent: 'root',
  pos: 'V',
  props,
  deleted: false,
});

describe('image blocks (#6005 image step)', () => {
  it('reads images as plain values, with alt from the caption or file name, and validated enums', () => {
    const read = blockImages(
      block({
        layout: 'grid',
        size: 'xl',
        images: [
          { src: 'colab-attachment:a1b2c3d4', alt: 'Sketch' },
          { src: 'colab-attachment:a1b2c3d4', caption: 'Phone' },
          { src: 'colab-attachment:a1b2c3d4', filename: 'menu.png' },
          { src: 42 },
          'not an image',
        ],
      }),
    );
    expect(read.layout).toBe('grid');
    expect(read.size).toBe('m');
    expect(read.images.map((image) => image.alt)).toEqual(['Sketch', 'Phone', 'menu.png']);
    expect(blockImages(block({ layout: '<b>' })).layout).toBe('carousel');
  });
  it('draws the spec states: read, loading, failed with Retry, and never-fetched not-found tiles', () => {
    const held = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    const source = {
      binding: {} as never,
      descriptors: [held, other].map((attachmentId) => ({
        attachmentId,
        mediaType: 'image/png',
        plaintextBytes: '68',
      })) as never,
    };
    const found = new Map([
      [
        `colab-attachment:11111111`,
        { reference: 'colab-attachment:11111111', url: 'data:image/png;base64,x' },
      ],
      [
        `colab-attachment:${other}`,
        { reference: `colab-attachment:${other}`, reason: 'unavailable' as const },
      ],
    ]);
    const spec = (reference: string) => ({ reference, alt: 'A' });
    const retried: string[] = [];
    const draw = (reference: string) =>
      drawnImage(spec(reference), found, source, (r) => retried.push(r));
    expect(draw('colab-attachment:11111111')).toMatchObject({
      src: 'data:image/png;base64,x',
      status: 'ready',
    });
    const failed = draw(`colab-attachment:${other}`);
    expect(failed).toMatchObject({ src: '', status: 'error' });
    failed.onRetry?.();
    expect(retried).toEqual([`colab-attachment:${other}`]);
    // Held but not read yet: the grey tile.
    expect(drawnImage(spec(`colab-attachment:${held}`), new Map(), source).status).toBe('loading');
    // Not on the page: not found, no Retry.
    expect(draw('colab-attachment:ffffffff')).toEqual({
      src: '',
      alt: 'A',
      status: 'not-found',
      notice: 'File not found',
    });
    // Any other source is never fetched.
    for (const outside of [
      'https://example.com/x.png',
      'data:image/png;base64,AAAA',
      'javascript:x',
    ])
      expect(draw(outside)).toEqual({
        src: '',
        alt: 'A',
        status: 'not-found',
        notice: 'Image not shown on this page',
      });
    // No attachment access here: nothing is read.
    expect(
      drawnImage(spec('colab-attachment:11111111'), found, { descriptors: source.descriptors })
        .notice,
    ).toBe('Image not available here');
  });
});
