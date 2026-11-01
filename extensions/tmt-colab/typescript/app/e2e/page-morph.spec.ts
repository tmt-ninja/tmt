import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * The in-place update's morph (#5022), one table of node cases. It runs the exact code of the
 * PAGE MORPH region of renderer.html in a blank page: `before` is the live body, `after` the new
 * source, `expected` the body afterwards. `kept` names the ids whose element must be the same node
 * (an in-place update keeps scroll, focus and state only on the nodes it keeps).
 */
const renderer = readFileSync(new URL('../public/renderer.html', import.meta.url), 'utf8');
const from = renderer.indexOf('// BEGIN PAGE MORPH');
const to = renderer.indexOf('// END PAGE MORPH');
if (from < 0 || to <= from) throw new Error('Missing renderer page morph markers');
const region = renderer.slice(from, to);

interface MorphCase {
  name: string;
  before: string;
  after: string;
  expected?: string;
  kept: string[];
  /** Applied to the live body before the morph: what the frame or the reader did to it. */
  live?: string;
}
const cases: MorphCase[] = [
  {
    name: 'text change',
    before: '<p id="a">one</p><p id="b">two</p>',
    after: '<p id="a">uno</p><p id="b">two</p>',
    kept: ['a', 'b'],
  },
  {
    name: 'insert',
    before: '<p id="a">A</p><p id="c">C</p>',
    after: '<p id="a">A</p><p id="b">B</p><p id="c">C</p>',
    kept: ['a', 'c'],
  },
  {
    name: 'remove',
    before: '<p id="a">A</p><p id="b">B</p><p id="c">C</p>',
    after: '<p id="a">A</p><p id="c">C</p>',
    kept: ['a', 'c'],
  },
  {
    name: 'reorder by id',
    before: '<p id="a">A</p><p id="b">B</p><p id="c">C</p>',
    after: '<p id="c">C</p><p id="a">A</p><p id="b">B</p>',
    kept: ['a', 'b', 'c'],
  },
  {
    name: 'attribute change',
    before: '<section id="s"><p id="a" class="x" title="t">A</p></section>',
    after: '<section id="s"><p id="a" class="y">A</p></section>',
    kept: ['s', 'a'],
  },
  {
    name: 'owner-marked skip',
    before: '<p id="a">A</p><p id="b">B</p><p id="c" data-choice="">C</p>',
    // A frame spacer after #a, a frame attribute on #b, and a choice the frame hid.
    live: 'owned',
    after: '<p id="a">A changed</p><p id="b">B</p><p id="c" data-choice="">C</p>',
    expected:
      '<p id="a">A changed</p><div data-colab-proposal-slot=""></div><p id="b" data-colab-question="">B</p><p id="c" data-choice="" hidden="">C</p>',
    kept: ['a', 'b', 'c'],
  },
  {
    name: 'expanded element compares its own attributes only',
    before: '<p id="a">A <tmt-icon id="i" name="check"></tmt-icon></p>',
    live: 'icon',
    after: '<p id="a">A, edited <tmt-icon id="i" name="x"></tmt-icon></p>',
    expected:
      '<p id="a">A, edited <tmt-icon id="i" name="x"><svg data-drawn=""></svg></tmt-icon></p>',
    kept: ['a', 'i'],
  },
  {
    name: 'reader state stays until its source attribute changes',
    before:
      '<details id="d"><summary>S</summary>T</details><input id="t" value="one"><input id="u" value="one">',
    live: 'reader',
    after:
      '<details id="d"><summary>S</summary>T, edited</details><input id="t" value="one"><input id="u" value="two">',
    expected:
      '<details id="d" open=""><summary>S</summary>T, edited</details><input id="t" value="one"><input id="u" value="two">',
    kept: ['d', 't', 'u'],
  },
  {
    // With the previous source given, a node whose source did not change is not compared again:
    // what the live node holds stays, while the changed node takes its new source.
    name: 'an unchanged source node is left alone',
    before: '<p id="a">A</p><section id="s"><p id="b">B</p></section>',
    live: 'drift',
    after: '<p id="a">A changed</p><section id="s"><p id="b">B</p></section>',
    expected:
      '<p id="a">A changed</p><section id="s"><p id="b">B, as the reader left it</p></section>',
    kept: ['a', 's', 'b'],
  },
  {
    name: 'a changed child inside an unchanged parent position is patched',
    before: '<section id="s"><p id="a">A</p><p id="b">B</p></section>',
    live: 'drift-a',
    after: '<section id="s"><p id="a">A</p><p id="b">B changed</p></section>',
    expected:
      '<section id="s"><p id="a">A, as the reader left it</p><p id="b">B changed</p></section>',
    kept: ['s', 'a', 'b'],
  },
];

test('the page morph table', async ({ page }) => {
  await page.setContent('<!doctype html><html><body></body></html>');
  const results = await page.evaluate(
    ({ region, cases }) => {
      const { morphPage, rememberSource } = new Function(
        `${region}\nreturn { morphPage, rememberSource };`,
      )() as {
        morphPage(live: Element, next: Element, owner: unknown): void;
        rememberSource(root: Element, state: WeakMap<Element, unknown>): void;
      };
      return cases.map((item) => {
        const body = document.body;
        body.innerHTML = item.before;
        const state = new WeakMap<Element, unknown>();
        rememberSource(body, state);
        const owned = new WeakSet<Node>();
        const hidden = new WeakSet<Element>();
        const values: Record<string, unknown> = {};
        if (item.live === 'owned') {
          const spacer = document.createElement('div');
          spacer.setAttribute('data-colab-proposal-slot', '');
          owned.add(spacer);
          body.querySelector('#a')!.after(spacer);
          body.querySelector('#b')!.setAttribute('data-colab-question', '');
          body.querySelector('#c')!.setAttribute('hidden', '');
          hidden.add(body.querySelector('#c')!);
        }
        if (item.live === 'icon') {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('data-drawn', '');
          body.querySelector('#i')!.append(svg);
        }
        if (item.live === 'drift')
          body.querySelector('#b')!.firstChild!.nodeValue = 'B, as the reader left it';
        if (item.live === 'drift-a')
          body.querySelector('#a')!.firstChild!.nodeValue = 'A, as the reader left it';
        if (item.live === 'reader') {
          (body.querySelector('#d') as HTMLDetailsElement).open = true;
          (body.querySelector('#t') as HTMLInputElement).value = 'typed';
          (body.querySelector('#u') as HTMLInputElement).value = 'typed';
        }
        const nodes = new Map(item.kept.map((id) => [id, body.querySelector(`#${id}`)]));
        const parse = (source: string) =>
          new DOMParser().parseFromString(
            `<!doctype html><html><head></head><body>${source}</body></html>`,
            'text/html',
          ).body;
        const next = parse(item.after);
        morphPage(body, next, {
          node: (node: Node) => owned.has(node),
          attribute: (el: Element, name: string) =>
            name.startsWith('data-colab-') || (name === 'hidden' && hidden.has(el)),
          expanded: (el: Element) => el.localName === 'tmt-icon',
          state,
          previous: parse(item.before),
        });
        if (item.live === 'reader') {
          values.t = (body.querySelector('#t') as HTMLInputElement).value;
          values.u = (body.querySelector('#u') as HTMLInputElement).value;
        }
        return {
          name: item.name,
          html: body.innerHTML,
          kept: item.kept.filter((id) => nodes.get(id) === body.querySelector(`#${id}`)),
          values,
        };
      });
    },
    { region, cases },
  );
  for (const [index, item] of cases.entries()) {
    const result = results[index];
    expect(result.html, item.name).toBe(item.expected ?? item.after);
    expect(result.kept, item.name).toEqual(item.kept);
  }
  // A typed value stays while its source attribute stays; a changed attribute replaces it.
  expect(
    results.find(
      (result) => result.name === 'reader state stays until its source attribute changes',
    )!.values,
  ).toEqual({ t: 'typed', u: 'two' });
});

// #5891: an update of a large page parses only its changed top-level nodes when that is the same
// as parsing the page whole. Each edit runs both ways from the same page: the parse of the run
// spliced into the bound body, and the live body morphed over that range only, must serialize
// exactly as the full parse does; an edit the scan cannot place is parsed whole.
const PAGE = [
  '<style>.note{color:teal}</style>',
  '<h1 id="t">Release plan</h1>',
  'Loose text at the top, then a comment.',
  '<!-- kept -->',
  // Left open: the next paragraph closes it. Only an edit beside it parses it again.
  '<p id="open">Left open, never closed',
  '<p id="p1">First <b>bold</b> paragraph &amp; more.</p>',
  '<ul id="l"><li>One</li><li>Two <i>it</i></li></ul>',
  '<div id="d"><p>Nested</p><pre>\ncode</pre></div>',
  '<table id="tb"><tr><td>1</td><td>2</td></tr></table>',
  '<tmt-question data-id="q1"><p data-question="">Pick one</p></tmt-question>',
  '<p id="p2">Second paragraph.</p>',
  '<section id="s"><h2>Part</h2><p>Body <a href="#x">link</a></p><img src="x.png" alt=""></section>',
  'Tail text <3 with a bare angle.',
].join('\n');
const edits: { name: string; after: string; fragment: boolean }[] = [
  {
    name: 'edit inside the open paragraph',
    after: PAGE.replace('never closed', 'still never closed'),
    fragment: true,
  },
  {
    name: 'text now follows the open paragraph',
    after: PAGE.replace('<p id="p1">First <b>bold</b> paragraph &amp; more.</p>', 'Plain now.'),
    fragment: true,
  },
  {
    // Text and a comment follow it, which a paragraph holds: the page parses whole.
    name: 'a paragraph left open before nodes it would hold',
    after: PAGE.replace('<h1 id="t">Release plan</h1>', '<p id="t">Release plan'),
    fragment: false,
  },
  {
    name: 'list items left open',
    after: PAGE.replace('<li>One</li><li>Two <i>it</i></li>', '<li>One<li><p>Two <i>it</i>'),
    fragment: true,
  },
  {
    name: 'definitions left open',
    after: PAGE.replace('<p id="p2">', '<dl><dt>Term<dd>One<dd>Two</dl><p id="p2">'),
    fragment: true,
  },
  {
    // An item with a formatting element left open in it cannot be placed.
    name: 'a list item with an open inline element',
    after: PAGE.replace('<li>One</li><li>', '<li><b>One<li>'),
    fragment: false,
  },
  {
    name: 'the open paragraph is closed',
    after: PAGE.replace('never closed', 'now closed</p>'),
    fragment: true,
  },
  {
    name: 'an inline node now follows the open paragraph',
    after: PAGE.replace('<p id="p1">First <b>bold</b> paragraph &amp; more.</p>', '<b>Bold</b>'),
    fragment: true,
  },
  {
    name: 'change at the start',
    after: PAGE.replace('Release plan', 'Release plan v2'),
    fragment: true,
  },
  {
    name: 'change in the middle',
    after: PAGE.replace('Second paragraph.', 'Second, edited.'),
    fragment: true,
  },
  { name: 'change at the end', after: PAGE.replace('bare angle.', 'bare angle!'), fragment: true },
  {
    name: 'insert a node',
    after: PAGE.replace('<p id="p2">', '<p id="new">New</p>\n<p id="p2">'),
    fragment: true,
  },
  {
    name: 'delete a node',
    after: PAGE.replace('<p id="p2">Second paragraph.</p>\n', ''),
    fragment: true,
  },
  { name: 'insert at the very start', after: `<p id="first">First</p>\n${PAGE}`, fragment: false },
  { name: 'append at the very end', after: `${PAGE}\n<p id="last">Last</p>`, fragment: true },
  {
    name: 'change inside a list',
    after: PAGE.replace('<li>One</li>', '<li>Uno</li>'),
    fragment: true,
  },
  {
    name: 'change inside a table',
    after: PAGE.replace('<td>1</td>', '<td>uno</td>'),
    fragment: false,
  },
  { name: 'change near a style', after: PAGE.replace('color:teal', 'color:navy'), fragment: false },
  {
    name: 'change in a question block',
    after: PAGE.replace('Pick one', 'Pick two'),
    fragment: false,
  },
  { name: 'text beside text', after: PAGE.replace('Loose text', 'Looser text'), fragment: true },
  {
    // The section after it closes it, as the parser does.
    name: 'an unclosed paragraph',
    after: PAGE.replace('<p id="p2">Second paragraph.</p>', '<p id="p2">Open'),
    fragment: true,
  },
  {
    name: 'a block inside a paragraph',
    after: PAGE.replace('<p id="p2">Second paragraph.</p>', '<p id="p2">A<div>B</div>C</p>'),
    fragment: false,
  },
  {
    name: 'a review block',
    after: PAGE.replace(
      '<p id="p2">',
      '<tmt-review data-id="r1"><p>Look</p></tmt-review><p id="p2">',
    ),
    fragment: false,
  },
  {
    name: 'a read block',
    after: PAGE.replace('<p id="p2">', '<tmt-read data-id="d1"><p>Read</p></tmt-read><p id="p2">'),
    fragment: false,
  },
  {
    name: 'a body tag',
    after: PAGE.replace('<p id="p2">', '<body class="x"><p id="p2">'),
    fragment: false,
  },
  {
    name: 'a script',
    after: PAGE.replace('<p id="p2">', '<script>1</script><p id="p2">'),
    fragment: false,
  },
  {
    name: 'an inline handler',
    after: PAGE.replace('<p id="p2">', '<p id="p2" onclick="x()">'),
    fragment: false,
  },
  {
    name: 'a stray end tag',
    after: PAGE.replace('Second paragraph.</p>', 'Second paragraph.</p></div>'),
    fragment: false,
  },
  {
    name: 'nested list item',
    after: PAGE.replace('<li>One</li>', '<li>One<ul><li>Inner</li></ul></li>'),
    fragment: true,
  },
];

test('a large page update parses only what changed, exactly as a full parse', async ({ page }) => {
  await page.setContent('<!doctype html><html><body></body></html>');
  const results = await page.evaluate(
    ({ region, before, edits }) => {
      const { morphPage, rememberSource, topLevelSpans, planFragment } = new Function(
        `${region}\nreturn { morphPage, rememberSource, topLevelSpans, planFragment };`,
      )();
      const parse = (source: string) =>
        new DOMParser().parseFromString(
          `<!doctype html><html><head></head><body>${source}</body></html>`,
          'text/html',
        ).body;
      const spans = topLevelSpans(before);
      return {
        placed: spans?.length === parse(before).childNodes.length,
        edits: edits.map((edit) => {
          const full = parse(edit.after).innerHTML;
          const plan = planFragment(before, spans, edit.after);
          if (!plan) return { name: edit.name, fragment: false };
          const part = parse(plan.text);
          // The bound body, spliced.
          const bound = parse(before);
          const next = bound.childNodes[plan.to] ?? null;
          const previous = document.createDocumentFragment();
          for (const node of [...bound.childNodes].slice(plan.from, plan.to)) previous.append(node);
          const spliced = part.cloneNode(true) as Element;
          bound.insertBefore(Object.assign(document.createDocumentFragment()), next);
          const parsed = bound.ownerDocument.createDocumentFragment();
          parsed.append(...spliced.childNodes);
          bound.insertBefore(parsed, next);
          // The live body, morphed over the run only.
          const body = document.body;
          body.innerHTML = '';
          body.append(...parse(before).childNodes);
          const state = new WeakMap();
          rememberSource(body, state);
          const candidates = [...body.childNodes];
          morphPage(
            body,
            part,
            {
              node: () => false,
              attribute: () => false,
              expanded: () => false,
              state,
              previous,
            },
            {
              candidates: candidates.slice(plan.from, plan.to),
              after: candidates[plan.to] ?? null,
            },
          );
          const respanned = topLevelSpans(edit.after);
          return {
            name: edit.name,
            fragment: true,
            count: part.childNodes.length === plan.count,
            bound: bound.innerHTML === full,
            live: body.innerHTML === full,
            spans: JSON.stringify(respanned) === JSON.stringify(plan.spans),
          };
        }),
      };
    },
    { region, before: PAGE, edits },
  );
  expect(results.placed).toBe(true);
  for (const [index, edit] of edits.entries()) {
    const result = results.edits[index];
    expect(result.fragment, edit.name).toBe(edit.fragment);
    if (result.fragment)
      expect(result, edit.name).toEqual({
        name: edit.name,
        fragment: true,
        count: true,
        bound: true,
        live: true,
        spans: true,
      });
  }
});
