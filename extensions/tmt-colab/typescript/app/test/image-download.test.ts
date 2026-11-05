import { expect, test } from 'vite-plus/test';
import {
  admitImageDownload,
  IMAGE_DOWNLOAD_BYTES,
  imageBytes,
  safeFilename,
} from '../src/image-download.js';

// #5981: a frame hands the parent a `data:` image it cannot save itself.
const bytes = (...values: number[]) => Buffer.from(values);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3, 4, 5, 6);
const GIF = Buffer.concat([Buffer.from('GIF89a'), bytes(1, 0, 1, 0, 0, 0)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), bytes(4, 0, 0, 0), Buffer.from('WEBPVP8 ')]);
const url = (type: string, data: Buffer) => `data:${type};base64,${data.toString('base64')}`;

test('a raster image whose bytes match its type is admitted with its decoded size', () => {
  for (const [type, data, ext] of [
    ['image/png', PNG, 'png'],
    ['image/jpeg', JPEG, 'jpg'],
    ['image/gif', GIF, 'gif'],
    ['image/webp', WEBP, 'webp'],
  ] as const) {
    const image = admitImageDownload(url(type, data), '');
    expect(image, type).toMatchObject({
      mediaType: type,
      length: data.length,
      filename: `image.${ext}`,
    });
    expect(Buffer.from(imageBytes(image!))).toEqual(data);
  }
});

test('a type the bytes do not match, SVG, other schemes and malformed base64 are refused', () => {
  expect(admitImageDownload(url('image/png', JPEG), 'x.png')).toBeUndefined();
  expect(admitImageDownload(url('image/jpeg', PNG), 'x.jpg')).toBeUndefined();
  expect(
    admitImageDownload(url('image/gif', Buffer.from('GIF87b......')), 'x.gif'),
  ).toBeUndefined();
  expect(
    admitImageDownload(url('image/webp', Buffer.from('RIFF....WEBX')), 'x.webp'),
  ).toBeUndefined();
  expect(admitImageDownload(url('image/svg+xml', Buffer.from('<svg/>')), 'x.svg')).toBeUndefined();
  expect(admitImageDownload(url('image/PNG', PNG), 'x.png')).toBeUndefined();
  expect(admitImageDownload(`data:image/png,${PNG.toString('base64')}`, 'x')).toBeUndefined();
  expect(
    admitImageDownload(`data:image/png;base64,${PNG.toString('base64').slice(1)}`, 'x'),
  ).toBeUndefined();
  expect(admitImageDownload('data:image/png;base64,iVBO$w0K', 'x')).toBeUndefined();
  expect(admitImageDownload('data:image/png;base64,', 'x')).toBeUndefined();
  expect(admitImageDownload('https://example.com/a.png', 'x')).toBeUndefined();
  expect(admitImageDownload(url('image/png', PNG), 7)).toBeUndefined();
  expect(admitImageDownload(null, 'x')).toBeUndefined();
});

test('the decoded size is counted from the base64 and capped before anything is decoded', () => {
  const at = Buffer.concat([PNG, Buffer.alloc(IMAGE_DOWNLOAD_BYTES - PNG.length)]);
  expect(admitImageDownload(url('image/png', at), 'a.png')?.length).toBe(IMAGE_DOWNLOAD_BYTES);
  const over = Buffer.concat([at, bytes(0)]);
  expect(admitImageDownload(url('image/png', over), 'a.png')).toBeUndefined();
  // A source longer than the largest image is refused before it is parsed.
  expect(admitImageDownload(`${url('image/png', at)}AAAA`, 'a.png')).toBeUndefined();
});

test('the frame’s name becomes plain text: no path or control characters, cut, typed', () => {
  expect(safeFilename('../../etc/passwd', 'png')).toBe('etcpasswd.png');
  expect(safeFilename('C:\\Users\\me\\shot.png', 'png')).toBe('CUsersmeshot.png');
  // Direction overrides cannot disguise the name (`gpj.exe` read backwards).
  expect(safeFilename('  .hidden name\u0000\u202egpj.exe ', 'jpg')).toBe('hidden namegpj.exe.jpg');
  expect(safeFilename('chart', 'webp')).toBe('chart.webp');
  // The saved name always carries the verified type.
  expect(safeFilename('photo.JPEG', 'jpg')).toBe('photo.JPEG');
  expect(safeFilename('notes.txt', 'png')).toBe('notes.txt.png');
  expect(safeFilename('...', 'gif')).toBe('image.gif');
  expect(safeFilename('', 'png')).toBe('image.png');
  const long = safeFilename('a'.repeat(400), 'png');
  expect(long).toBe(`${'a'.repeat(124)}.png`);
  expect([...safeFilename(`${'雪'.repeat(200)}.png`, 'png')].length).toBeLessThanOrEqual(128);
});
