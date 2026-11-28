import { expect, it } from 'vite-plus/test';
import {
  DIAGRAM_LINES,
  DIAGRAM_SOURCE_BYTES,
  admitDiagram,
  diagramError,
} from '../src/diagram-source.js';

it('draws the five kinds and nothing else, within the size Mermaid is given (#6746)', () => {
  expect(admitDiagram('flowchart LR\n  A --> B')).toEqual({
    ok: true,
    kind: 'flowchart',
    source: 'flowchart LR\n  A --> B',
  });
  // A comment or blank line may come first; `graph`, `stateDiagram` and `classDiagram` are the
  // older names.
  expect(admitDiagram('\n%% why\ngraph TD\n  A --> B')).toMatchObject({
    ok: true,
    kind: 'flowchart',
  });
  for (const [first, kind] of [
    ['sequenceDiagram', 'sequence'],
    ['stateDiagram-v2', 'state'],
    ['stateDiagram', 'state'],
    ['gantt', 'gantt'],
    ['classDiagram-v2', 'class'],
    ['classDiagram', 'class'],
  ] as const)
    expect(admitDiagram(`${first}\n  A`)).toMatchObject({ ok: true, kind });
  for (const other of ['pie', 'erDiagram', 'journey', 'mindmap', 'gitGraph', 'C4Context'])
    expect(admitDiagram(`${other}\n  A`)).toEqual({ ok: false, reason: 'kind' });
  expect(admitDiagram('flowchartish\n')).toEqual({ ok: false, reason: 'kind' });
  expect(admitDiagram('sequenceDiagrams\n')).toEqual({ ok: false, reason: 'kind' });
  expect(admitDiagram('---\ntitle: x\n---\nflowchart LR')).toEqual({ ok: false, reason: 'kind' });
  expect(admitDiagram('  \n%% only a comment')).toEqual({ ok: false, reason: 'empty' });
  expect(admitDiagram('')).toEqual({ ok: false, reason: 'empty' });
  expect(admitDiagram('%%{init: {"theme": "dark"}}%%\nflowchart LR')).toEqual({
    ok: false,
    reason: 'directive',
  });
  // Counted in UTF-8 bytes: 16 KiB of three-byte characters is over.
  const at = 'flowchart LR\n%% ';
  expect(admitDiagram(at + 'a'.repeat(DIAGRAM_SOURCE_BYTES - at.length)).ok).toBe(true);
  expect(admitDiagram(at + 'a'.repeat(DIAGRAM_SOURCE_BYTES - at.length + 1))).toEqual({
    ok: false,
    reason: 'size',
  });
  expect(admitDiagram(at + '流'.repeat(6000))).toEqual({ ok: false, reason: 'size' });
});

it('bounds the four kinds Mermaid does not by their drawing lines, not their comments', () => {
  const body = (count: number) => Array.from({ length: count }, (_, at) => `  A->>B: ${at}`);
  expect(DIAGRAM_LINES).toEqual({ sequence: 400, state: 300, gantt: 400, class: 300 });
  for (const [first, kind] of [
    ['sequenceDiagram', 'sequence'],
    ['stateDiagram-v2', 'state'],
    ['gantt', 'gantt'],
    ['classDiagram', 'class'],
  ] as const) {
    const limit = DIAGRAM_LINES[kind];
    // The first line counts; blank lines and comments do not.
    const at = [first, ...body(limit - 1), '', '%% note'].join('\n');
    expect(admitDiagram(at), kind).toMatchObject({ ok: true, kind });
    expect(admitDiagram(`${at}\n  A->>B: one more`)).toEqual({ ok: false, reason: 'lines', limit });
  }
  // A flowchart is bounded by its edges, which Mermaid counts.
  expect(admitDiagram(['flowchart LR', ...body(400)].join('\n')).ok).toBe(true);
  // A left-out styling line is not a drawing line.
  const full = ['sequenceDiagram', ...body(DIAGRAM_LINES.sequence - 1)].join('\n');
  expect(admitDiagram(`${full}\n  links A: {}`).ok).toBe(true);
});

it('leaves the styling and links a source carries out: the look is the page one', () => {
  const admitted = admitDiagram(
    [
      'flowchart LR',
      '  A:::warn --> B',
      '  style A fill:url(https://example.com/a.png)',
      '  classDef warn fill:#f00',
      '  class B warn',
      '  linkStyle 0 stroke:red',
      '  click A href "javascript:alert(1)"',
      '  B --> C[class]',
    ].join('\n'),
  );
  expect(admitted).toEqual({
    ok: true,
    kind: 'flowchart',
    source: ['flowchart LR', '  A --> B', '', '', '', '', '', '  B --> C[class]'].join('\n'),
  });
});

it("leaves out each kind's own styling and links, in any case its lexer reads", () => {
  const kept = (lines: string[]) => {
    const admitted = admitDiagram(lines.join('\n'));
    return admitted.ok ? admitted.source.split('\n') : admitted.reason;
  };
  // A sequence keeps its groupings (the page sets their fill) and loses its actors' menus.
  expect(
    kept([
      'sequenceDiagram',
      '  box Aqua Team',
      '  participant A',
      '  end',
      '  link A: Docs @ https://example.com',
      '  LINKS A: {"x": "javascript:alert(1)"}',
      '  properties A: {"class": "x"}',
      '  details A: {}',
      '  rect rgb(255, 0, 0)',
      '  A->>A: hi:::x',
      '  end',
      '  linker->>A: a participant named link…',
    ]),
  ).toEqual([
    'sequenceDiagram',
    '  box Aqua Team',
    '  participant A',
    '  end',
    '',
    '',
    '',
    '',
    '  rect rgb(255, 0, 0)',
    '  A->>A: hi:::x',
    '  end',
    '  linker->>A: a participant named link…',
  ]);
  expect(
    kept([
      'stateDiagram-v2',
      '  [*] --> A:::warn',
      '  classDef warn fill:red',
      '  CLASS A warn',
      '  style A fill:red',
      '  click A "https://example.com"',
      '  A --> B',
    ]),
  ).toEqual(['stateDiagram-v2', '  [*] --> A', '', '', '', '', '  A --> B']);
  // `class Name` declares a class here: only the styling statements go.
  expect(
    kept([
      'classDiagram',
      '  class Shape:::warn {',
      '    +area() int',
      '  }',
      '  style Shape fill:red',
      '  classDef warn fill:red',
      '  cssClass "Shape" warn',
      '  click Shape href "https://example.com"',
      '  link Shape "https://example.com"',
      '  callback Shape "run"',
      '  Shape <|-- Square',
    ]),
  ).toEqual([
    'classDiagram',
    '  class Shape {',
    '    +area() int',
    '  }',
    '',
    '',
    '',
    '',
    '',
    '',
    '  Shape <|-- Square',
  ]);
  // Gantt: no links, no custom ticks, no day-by-day excludes walk, and never today's marker; the
  // marker is turned off after the source, so Mermaid's line numbers stay the source's.
  expect(
    kept([
      'gantt',
      '  dateFormat YYYY-MM-DD',
      '  tickInterval 1day',
      '  EXCLUDES weekends',
      '  todayMarker stroke:red',
      '  a :t1, 2026-01-01, 3d',
      '  click t1 href "https://example.com"',
    ]),
  ).toEqual([
    'gantt',
    '  dateFormat YYYY-MM-DD',
    '',
    '',
    '',
    '  a :t1, 2026-01-01, 3d',
    '',
    'todayMarker off',
  ]);
});

it('reads the line, the caret excerpt and the detail from a Mermaid error', () => {
  expect(
    diagramError(
      new Error("Parse error on line 3:\n...B -->>|是| C\n-----^\nExpecting 'SEMI', got 'ARROW'"),
    ),
  ).toEqual({
    line: 3,
    excerpt: '...B -->>|是| C\n-----^',
    detail: "Expecting 'SEMI', got 'ARROW'",
  });
  // A message without a caret is read whole.
  expect(diagramError('Lexical error')).toEqual({ excerpt: 'Lexical error' });
  expect(diagramError(new Error('x'.repeat(700))).excerpt).toHaveLength(601);
});
