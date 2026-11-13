import { describe, expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
// @ts-expect-error The generator is a plain development script.
import { stageCompactCss } from '../scripts/stage-compact-css.mjs';

const tokens = JSON.parse(
  readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'),
);

/** The bodies of every top-level at-rule block whose prelude matches, by brace depth. */
function blocks(css: string, prelude: RegExp) {
  const found: { condition: string; body: string }[] = [];
  for (const match of css.matchAll(prelude)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    for (; depth && end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}') depth--;
    }
    found.push({ condition: match[1]!.replace(/\s+/g, ''), body: css.slice(start, end - 1) });
  }
  return found;
}
/** The selectors a block styles, one per rule, normalized. */
const selectors = (body: string) =>
  [...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1]!.replace(/\s+/g, ' ').trim())
    .sort();
/** A selector as the minifier writes it: no space around combinators, no quotes, and the legacy
 * single colon on ::before and ::after. */
const tight = (css: string) =>
  css
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/['"]/g, '')
    .replace(/::(before|after)\b/g, ':$1');
const width = (condition: string) =>
  condition.replace(/^max-width:(\d+)px$/, 'width<=$1px').replace(/^width<(\d+)px$/, 'width<$1px');

/** #5981: a phone stage cannot drift from the phone product: the stage gets every narrow-width
 * shell and list rule, generated from their stylesheets as container queries on the stage. */
describe('stage compact shell CSS', () => {
  const shell = ['shell', 'list']
    .map((name) => readFileSync(new URL(`../src/${name}.css`, import.meta.url), 'utf8'))
    .join('\n')
    .replaceAll('__compact-max-width__', tokens.header['compact-max-width']);
  const media = blocks(shell, /@media \(([^)]*width[^)]*)\) \{/g);

  it('copies each shell width block as a stage container query with stage units', () => {
    const generated = blocks(stageCompactCss(shell), /@container tmt-ds-scope \(([^)]*)\) \{/g);
    expect(generated.map((block) => block.condition)).toEqual(
      media.map((block) => block.condition),
    );
    generated.forEach((block, index) => {
      expect(selectors(block.body)).toEqual(selectors(media[index]!.body));
      expect(block.body).not.toMatch(/\b100d?vw\b|\b100dvh\b/);
    });
    expect(generated.length).toBeGreaterThan(2);
  });

  it('refuses a window unit it cannot read from the stage', () => {
    const narrow = (value: string) =>
      `@media (max-width: 900px) {\n  .x {\n    height: ${value};\n  }\n}`;
    expect(stageCompactCss(narrow('100dvh'))).toContain('100cqh');
    expect(stageCompactCss(narrow('calc(100vw - 8px)'))).toContain('100cqw');
    for (const value of ['50vh', '100svh', '100lvh', '40dvw', '10vmin', '2vi'])
      expect(() => stageCompactCss(narrow(value)), value).toThrow(/window unit/);
    // A unit outside the narrow blocks is not copied, so it is not refused.
    expect(() => stageCompactCss(`.y { height: 50vh; }\n${narrow('1px')}`)).not.toThrow();
  });

  it('ships every narrow selector in a stage container block of the same width', () => {
    // The shipped, minified file: what a page and the docs load.
    const shipped = blocks(
      readFileSync(new URL('../generated/static.css', import.meta.url), 'utf8'),
      /@container tmt-ds-scope \(([^)]*)\)\{/g,
    );
    for (const block of media) {
      const stage = shipped
        .filter((entry) => width(entry.condition) === width(block.condition))
        .map((entry) => tight(entry.body))
        .join('\n');
      for (const selector of selectors(block.body))
        for (const part of selector.split(/\s*,\s*/))
          expect(stage, `${block.condition} ${part}`).toContain(tight(part));
    }
  });
});
