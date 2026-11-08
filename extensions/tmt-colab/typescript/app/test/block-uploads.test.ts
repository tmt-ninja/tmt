import { describe, expect, test } from 'vite-plus/test';
import { cardSize, fileBlock, fitsAttachments, readBlockFile } from '../src/block-uploads.js';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2,
  0, 0, 0, 3, 8, 6, 0, 0, 0,
]);

describe('block uploads (#6202)', () => {
  test('the bytes decide image or file card, never the name or declared type', async () => {
    const image = await readBlockFile(new File([PNG], 'notes.txt', { type: 'text/plain' }));
    expect(image).toMatchObject({ image: true, input: { mediaType: 'image/png' } });
    const text = await readBlockFile(new File(['hello'], 'shot.png', { type: 'image/png' }));
    expect(text).toMatchObject({ image: false, input: { mediaType: 'text/plain' } });
  });

  test('an empty file is refused, and a control character never reaches the name', async () => {
    expect(await readBlockFile(new File([], 'a.txt'))).toBe('empty');
    const read = await readBlockFile(new File(['x'], 'a\u0007/b.txt'));
    expect(read).toMatchObject({ input: { filename: 'a__b.txt' } });
  });

  test('an image is a single image of the stored file; anything else a card with no link until stored', async () => {
    const stored = { original: { descriptor: { attachmentId: 'f'.repeat(32) } } } as never;
    const image = { image: true, input: { filename: 'a.png', mediaType: 'image/png', bytes: PNG } };
    expect(fileBlock(image, stored)).toEqual({
      type: 'image',
      props: {
        layout: 'single',
        images: [{ src: `colab-attachment:${'f'.repeat(32)}`, alt: 'a.png' }],
      },
    });
    const file = {
      image: false,
      input: { filename: 'a.txt', mediaType: 'text/plain', bytes: new Uint8Array(2048) },
    };
    expect(fileBlock(file).props).toEqual({
      variant: 'file',
      files: [{ name: 'a.txt', size: '2 KB', type: 'text/plain' }],
    });
    expect(fileBlock(file, stored).props.files).toEqual([
      {
        name: 'a.txt',
        size: '2 KB',
        type: 'text/plain',
        href: `colab-attachment:${'f'.repeat(32)}`,
      },
    ]);
  });

  test('a card size is short: bytes, then binary KB and MB', () => {
    expect([16, 2048, 2560, 15 * 1024, 8 * 1024 * 1024].map(cardSize)).toEqual([
      '16 B',
      '2 KB',
      '2.5 KB',
      '15 KB',
      '8 MB',
    ]);
  });

  test('the page cap is 128 descriptors, counted before any upload', () => {
    expect(fitsAttachments(127, 1)).toBe(true);
    expect(fitsAttachments(127, 2)).toBe(false);
  });
});
