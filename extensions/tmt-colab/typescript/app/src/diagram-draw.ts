/**
 * Draws an admitted diagram of one of the five kinds (#6746). Loaded on its own, only when a page
 * shows a diagram block:
 * Mermaid in strict mode with SVG text labels and the page's theme, then the SVG cleaned again,
 * so nothing from the source runs, links or loads.
 */
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import {
  DIAGRAM_EDGES,
  DIAGRAM_SOURCE_BYTES,
  diagramError,
  type DiagramError,
} from './diagram-source.js';

export interface DiagramTheme {
  dark: boolean;
  /** Mermaid theme variables, each a colour Mermaid can compute with (`rgb(...)`). */
  variables: Readonly<Record<string, string>>;
  fontFamily: string;
}

export type Drawn = { svg: string } | { error: DiagramError };

/** Mermaid keys a source can never set, whatever it carries. */
const SECURE = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'maxEdges',
  'suppressErrorRendering',
  'theme',
  'themeVariables',
  'themeCSS',
  'darkMode',
  'fontFamily',
  'altFontFamily',
  'htmlLabels',
  'flowchart',
  'sequence',
  'state',
  'class',
  'gantt',
  'look',
  'layout',
  'handDrawnSeed',
  'deterministicIds',
];

/** The CSS that puts every edge label on an opaque backing of `colour`, a colour the page
 * computed (`rgb(...)`); Mermaid scopes it to the diagram, after its own rules. */
function labelBacking(colour: string | undefined): string {
  return colour && /^rgba?\([\d.,\s/%]+\)$/.test(colour)
    ? `.edgeLabel .label rect { fill: ${colour} !important; opacity: 1 !important; }`
    : '';
}

/** A Gantt chart's drawn width in px. */
const GANTT_WIDTH = 720;

let queue: Promise<unknown> = Promise.resolve();

/** The diagram drawn as clean SVG markup, or Mermaid's reason it cannot be. One at a time: Mermaid's
 * settings are global. */
export function drawDiagram(id: string, source: string, theme: DiagramTheme): Promise<Drawn> {
  const next = queue.then(async (): Promise<Drawn> => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: DIAGRAM_SOURCE_BYTES,
      maxEdges: DIAGRAM_EDGES,
      deterministicIds: true,
      htmlLabels: false,
      // Drawn at its own size: a wide diagram scrolls on a phone rather than shrinking its text.
      // A compact layout, so a common flowchart, state or class diagram fits a page column with its
      // text at full size.
      flowchart: { htmlLabels: false, useMaxWidth: false, nodeSpacing: 28, rankSpacing: 36 },
      state: { useMaxWidth: false, nodeSpacing: 28, rankSpacing: 36 },
      class: { htmlLabels: false, useMaxWidth: false, nodeSpacing: 28, rankSpacing: 36 },
      sequence: {
        useMaxWidth: false,
        actorFontFamily: theme.fontFamily,
        noteFontFamily: theme.fontFamily,
        messageFontFamily: theme.fontFamily,
      },
      // A Gantt chart is as wide as it is told, not as the hidden box Mermaid draws it in: one
      // width everywhere, the page column's at 1440. Its dates read month-day unless the source
      // names a format: a full date at every daily tick runs into the next.
      gantt: { useMaxWidth: false, useWidth: GANTT_WIDTH, axisFormat: '%m-%d' },
      theme: 'base',
      darkMode: theme.dark,
      fontFamily: theme.fontFamily,
      themeVariables: { ...theme.variables, fontFamily: theme.fontFamily },
      // Every edge label sits on an opaque backing in the page's colour, so no line runs through
      // its words: Mermaid's own is half transparent, and a state or class label's is a node fill.
      themeCSS: labelBacking(theme.variables.edgeLabelBackground),
      secure: SECURE,
    });
    try {
      const { svg } = await mermaid.render(id, source);
      return { svg: clean(svg) };
    } catch (error) {
      return { error: diagramError(error) };
    }
  });
  queue = next.catch(() => {});
  return next;
}

/** A local reference (`#marker`), the only kind a drawn diagram keeps. */
const LOCAL_URL = /url\(\s*['"]?(?!#)/i;

/** The SVG with nothing that can run, link or load: no script, link, image, foreign HTML or use,
 * no event or href attribute, and no style or CSS that reaches outside the diagram. */
function clean(svg: string): string {
  const purify = DOMPurify();
  purify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (LOCAL_URL.test(data.attrValue) || /@import|expression\(/i.test(data.attrValue))
      data.keepAttr = false;
  });
  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && /@import|url\(\s*['"]?(?!#)/i.test(node.textContent ?? ''))
      node.textContent = '';
  });
  return purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['a', 'foreignObject', 'image', 'use', 'script', 'iframe', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href', 'src', 'action', 'formaction'],
  });
}
