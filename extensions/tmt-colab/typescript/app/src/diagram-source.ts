/**
 * Which diagram sources a page draws (#6746): the one place the admitted Mermaid kinds live. A
 * diagram block stores any plain text, so typing through a half-written source is never refused;
 * the page draws a source only when it is one of five kinds within the size Mermaid is given, and
 * with no directive, styling or link of its own, since the design system draws every diagram alike.
 */

/** The most UTF-8 bytes of source the page draws (Mermaid's `maxTextSize`). */
export const DIAGRAM_SOURCE_BYTES = 16 * 1024;
/** The most edges a drawn flowchart may have (Mermaid's `maxEdges`). */
export const DIAGRAM_EDGES = 400;

export type DiagramKind = 'flowchart' | 'sequence' | 'state' | 'gantt' | 'class';

/**
 * The most lines that are neither blank nor a comment in a drawn diagram of each kind past the
 * flowchart. Mermaid bounds only a flowchart's edges; these bound the others' layout work alike: a
 * state or class diagram at 300 lines takes about as long as a flowchart at its 400 edges (both
 * laid out by dagre), where 400 lines took about 1.4 times as long (#6746).
 */
export const DIAGRAM_LINES: Readonly<Record<Exclude<DiagramKind, 'flowchart'>, number>> = {
  sequence: 400,
  state: 300,
  gantt: 400,
  class: 300,
};

export type DiagramSource =
  | { ok: true; kind: DiagramKind; source: string }
  | { ok: false; reason: 'empty' | 'kind' | 'size' | 'directive' }
  | { ok: false; reason: 'lines'; limit: number };

interface Admission {
  kind: DiagramKind;
  /** The first line that is neither blank nor a comment names the kind. */
  first: RegExp;
  /** Lines that would restyle the diagram, link out or set what the page sets: left out. */
  styling: RegExp;
}

/**
 * Per kind, what the page leaves out, matched as Mermaid's own lexer matches it (sequence, state
 * and Gantt keywords in any case). A node's `:::class` goes with the styling of every kind but
 * sequence, which has none. In a class diagram `class Name` declares a class, so only its styling
 * statements go. A sequence's `rect` and `box` keep their grouping; the page's stylesheet sets their
 * fill, so a colour in the source changes nothing. In a Gantt chart, `tickInterval` can ask for up
 * to 10,000 ticks, and `excludes` makes Mermaid walk every task day by day, unbounded by the source's
 * size (`a, 2020-01-01, 100000d`); the today marker is turned off, so a drawing never depends on
 * today.
 */
const KINDS: readonly Admission[] = [
  {
    kind: 'flowchart',
    first: /^\s*(?:flowchart|graph)(?:\s|$)/,
    styling: /^\s*(?:style|classDef|class|linkStyle|click)\b/,
  },
  {
    kind: 'sequence',
    first: /^\s*sequenceDiagram(?:\s|$)/,
    // An actor's menu links and its properties: `link A: Docs @ https://…`, `links A: {…}`.
    styling: /^\s*(?:links?|properties|details)\s/i,
  },
  {
    kind: 'state',
    first: /^\s*stateDiagram(?:-v2)?(?:\s|$)/,
    styling: /^\s*(?:classDef|class|style|click)\s/i,
  },
  {
    kind: 'gantt',
    first: /^\s*gantt(?:\s|$)/,
    styling: /^\s*(?:click|tickInterval|todayMarker|excludes)\s/i,
  },
  {
    kind: 'class',
    first: /^\s*classDiagram(?:-v2)?(?:\s|$)/,
    styling: /^\s*(?:style|classDef|cssClass|click|link|callback)\s/,
  },
];

const drawing = (line: string) => line.trim() !== '' && !line.trim().startsWith('%%');

/** The source as the page draws it, or why it is not drawn. */
export function admitDiagram(text: string): DiagramSource {
  if (new TextEncoder().encode(text).length > DIAGRAM_SOURCE_BYTES)
    return { ok: false, reason: 'size' };
  // An init directive or front matter would change the theme, the security level or the layout.
  if (text.includes('%%{')) return { ok: false, reason: 'directive' };
  const lines = text.split('\n');
  const first = lines.find(drawing);
  if (first === undefined) return { ok: false, reason: 'empty' };
  const admission = KINDS.find((kind) => kind.first.test(first));
  if (!admission) return { ok: false, reason: 'kind' };
  const { kind, styling } = admission;
  // A left-out line stays as a blank one, so Mermaid's line numbers are the source's.
  const kept = lines.map((line) =>
    styling.test(line) ? '' : kind === 'sequence' ? line : line.replace(/:::[\w-]+/g, ''),
  );
  const limit = kind === 'flowchart' ? undefined : DIAGRAM_LINES[kind];
  if (limit !== undefined && kept.filter(drawing).length > limit)
    return { ok: false, reason: 'lines', limit };
  return {
    ok: true,
    kind,
    // Appended, never inserted, so a line Mermaid names is still the source's own.
    source: kind === 'gantt' ? `${kept.join('\n')}\ntodayMarker off` : kept.join('\n'),
  };
}

export interface DiagramError {
  /** The 1-based line Mermaid names. */
  line?: number;
  /** What a person reads first: the source near the problem and Mermaid's caret under it, or its
   * whole message when it has no caret. */
  excerpt: string;
  /** The rest of Mermaid's own text (the tokens it expected), for whoever wants it. */
  detail?: string;
}

const clip = (text: string) => (text.length > 600 ? `${text.slice(0, 600)}…` : text);

/** Mermaid's line, excerpt and detail for a source it cannot read. */
export function diagramError(error: unknown): DiagramError {
  const raw = error instanceof Error ? error.message : String(error);
  const line = /line (\d+)/i.exec(raw)?.[1];
  const lines = raw
    .replace(/^Parse error on line \d+:\s*/i, '')
    .trim()
    .split('\n');
  const caret = lines.findIndex((text) => /^-*\^$/.test(text.trim()));
  const excerpt = caret < 0 ? lines.join('\n') : lines.slice(0, caret + 1).join('\n');
  const detail =
    caret < 0
      ? ''
      : lines
          .slice(caret + 1)
          .join('\n')
          .trim();
  return {
    ...(line ? { line: Number(line) } : {}),
    excerpt: clip(excerpt),
    ...(detail ? { detail: clip(detail) } : {}),
  };
}
