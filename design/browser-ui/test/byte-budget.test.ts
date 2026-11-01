import { expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

/** #5815 / #5840: GUI approved each PR's exact measured delta, without headroom.
 * Shared rail, attention dot and metric roles: 22,685 -> 23,006 bytes (+321), Linux CI:
 * https://github.com/tmt-ninja/tmt/actions/runs/41228247407/job/124619513775.
 * A second-merging overlap rebases and re-measures; later growth requires owner approval. */
/** #5821: palette B's scope, the ref tier, the Select, Skeleton, Empty, Card and Surface parts, the
 * elevation scale, component motion, the text-action and accent-fill roles, the floating dock and
 * the chip height, 23,006 -> 27,107. Switching to B as the default deletes the current palette's
 * blocks and lowers this; pending GUI approval with the Linux CI measurement on its PR. */
const approvedGzipBytes = 27_107;
/** #5794: the editorial layer is its own entry, loaded only by prose surfaces, so it has its own cap.
 * #5821: prose tables scroll under the compact width, 951 -> 999 bytes. Pending GUI approval with the
 * Linux CI measurement on its PR; no headroom. */
const approvedEditorialGzipBytes = 999;

const gzipped = (name: string) =>
  gzipSync(readFileSync(new URL(`../generated/${name}.css`, import.meta.url)), { level: 9 }).length;

it('keeps the shipped stylesheets within the approved gzip cap', () => {
  expect(gzipped('static') + gzipped('ui')).toBeLessThanOrEqual(approvedGzipBytes);
});

it('keeps the editorial layer within its approved gzip cap', () => {
  expect(gzipped('editorial')).toBeLessThanOrEqual(approvedEditorialGzipBytes);
});

/** #5821 A4: the rich input ships in its own entry. No other entry reaches Lexical or its stylesheet,
 * and the shared stylesheets carry none of its rules, so the shared caps above do not pay for it. */
it('keeps Lexical and the rich input out of every shared entry', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const seen = new Set<string>();
  const reached: string[] = [];
  const visit = (url: URL) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = readFileSync(url, 'utf8');
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      if (/^(@lexical\/|lexical$)/.test(specifier!) || specifier!.includes('rich-input'))
        reached.push(`${url.pathname.split('/browser-ui/')[1]} -> ${specifier}`);
      if (!specifier!.startsWith('.')) continue;
      const base = new URL(specifier!.replace(/\.js$/, ''), url);
      const file = ['.ts', '.tsx', '/index.ts']
        .map((ext) => new URL(`${base.href}${ext}`))
        .find((candidate) => {
          try {
            readFileSync(candidate);
            return true;
          } catch {
            return false;
          }
        });
      if (file) visit(file);
    }
  };
  for (const [name, target] of Object.entries(manifest.exports) as [string, string][])
    if (/\.tsx?$/.test(target) && name !== './rich-input' && !name.startsWith('./gallery'))
      visit(new URL(`../${target.slice(2)}`, import.meta.url));
  expect(reached).toEqual([]);
  for (const name of ['static', 'ui'])
    expect(
      readFileSync(new URL(`../generated/${name}.css`, import.meta.url), 'utf8'),
    ).not.toContain('tmt-rich-input');
});
