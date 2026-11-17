// Raster output of the approved #5971 mark; the shared brand generator owns its artwork.
// Regenerate locally with the package-pinned Chromium. CI checks provenance and dimensions,
// rather than byte-exact anti-aliasing across different hosts.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

if (process.argv.length !== 3 || process.argv[2] !== '--write') {
  throw new Error('Use: node scripts/generate-icons.mjs --write');
}
const source = 'design/browser-ui/generated/favicon.svg';
const svg = await readFile(new URL('../../../../../' + source, import.meta.url));
const sizes = [16, 24, 32, 48, 128];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const icons = await page.evaluate(
    async ({ svg, sizes }) => {
      const image = new Image();
      image.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
      await image.decode();
      return sizes.map((size) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No canvas renderer.');
        context.drawImage(image, 0, 0, size, size);
        return { size, png: canvas.toDataURL('image/png').split(',')[1] };
      });
    },
    { svg: svg.toString('utf8'), sizes },
  );
  const directory = new URL('../public/icons/', import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const { size, png } of icons) {
    await writeFile(new URL(`icon-${size}.png`, directory), Buffer.from(png, 'base64'));
  }
  await writeFile(
    new URL('source.json', directory),
    JSON.stringify(
      {
        source,
        sha256: createHash('sha256').update(svg).digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Generated ${icons.length} icons from ${source}.`);
} finally {
  await browser.close();
}
