/**
 * A part's narrow-width rules again for a design-system stage (#5981). A stage is sized by its
 * caller, not the window, so each `@media` width block of the given stylesheets is emitted once
 * more as a container query on the stage, with window units read from the stage. One source, so
 * a phone stage cannot drift from the phone product. The caller places the result after the
 * stylesheets, so a stage rule wins over the base rule it narrows.
 */
const WIDTH = /@media \(((?:max-width: \d+px)|(?:width < \d+px))\) \{/g;
/** A window unit the copy does not rewrite: it would size a stage by the window. */
const WINDOW_UNIT = /\d(?:d|s|l)?v(?:h|w|i|b|min|max)\b/;

export function stageCompactCss(source) {
  const blocks = [];
  for (const match of source.matchAll(WIDTH)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    for (; depth && end < source.length; end++) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}') depth--;
    }
    if (depth) throw new Error(`Unclosed @media (${match[1]}) in a stage stylesheet`);
    const body = source
      .slice(start, end - 1)
      .replaceAll('100vw', '100cqw')
      .replaceAll('100dvh', '100cqh');
    const left = WINDOW_UNIT.exec(body.replace(/\/\*[\s\S]*?\*\//g, ''));
    if (left)
      throw new Error(
        `@media (${match[1]}) uses the window unit "${left[0]}"; a stage copy reads only 100vw and 100dvh`,
      );
    blocks.push(`@container tmt-ds-scope (${match[1]}) {${body}}`);
  }
  if (!blocks.length) throw new Error('No width blocks in the stage stylesheets');
  return blocks.join('\n');
}
