import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vite-plus/test';
import type { BlockRecord } from '../src/block-model.js';
import { posBetween } from '../src/block-pos.js';
import { BlockTree } from '../src/block-tree.js';
import { StructuredPage } from '../src/structured-page.js';

/** Attributes that load or navigate to a URL. */
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'action',
  'formaction',
  'poster',
  'xlink:href',
]);

/** Every string a page writer controls, at once: markup, a script URL, a CSS url() and a class. */
const HOSTILE =
  '"><script>alert(1)</script><img src=x onerror=alert(1)> javascript:alert(1) ' +
  'url(https://evil.example/x) expression(alert(1)) evil-class" style="color:red';

/**
 * A page of blocks draws in the trusted parent (#6005), so no value a page writer wrote may reach
 * the DOM as markup, an event handler, a URL, a style or a class: text is text, and only validated
 * enums and admitted link schemes choose anything. Every part the editor draws gets the hostile
 * string in every field it reads.
 */
it('hostile props and text reach the markup only as escaped text', () => {
  let at: string | undefined;
  const pos = () => (at = posBetween(at));
  const block = (
    id: string,
    type: BlockRecord['type'],
    props: Record<string, unknown>,
    extra: Partial<BlockRecord> = {},
  ): BlockRecord => ({
    id,
    type,
    parent: 'root',
    pos: pos(),
    props,
    deleted: false,
    ...extra,
  });
  const hostileMarks = [
    { from: 0, to: 4, mark: 'link' as const, value: 'javascript:alert(1)' },
    { from: 4, to: 8, mark: 'link' as const, value: 'data:text/html,<script>alert(1)</script>' },
    { from: 8, to: 12, mark: 'block' as const, value: HOSTILE },
    { from: 12, to: 16, mark: 'agent' as const, value: HOSTILE },
    { from: 16, to: 20, mark: 'bold' as const },
  ];
  const records: BlockRecord[] = [
    block('p', 'paragraph', { tone: HOSTILE }, { text: HOSTILE, marks: hostileMarks }),
    block('h', 'heading', { level: HOSTILE }, { text: HOSTILE }),
    block('l', 'list', { style: HOSTILE, indent: HOSTILE }, { text: HOSTILE }),
    block('t', 'todo', { checked: HOSTILE, assignee: HOSTILE, indent: 9 }, { text: HOSTILE }),
    block('c', 'callout', { tone: HOSTILE, label: HOSTILE, heading: HOSTILE }, { text: HOSTILE }),
    block('k', 'code', { language: HOSTILE, filename: HOSTILE }, { text: HOSTILE }),
    block('card', 'card', { title: HOSTILE, variant: HOSTILE, meta: HOSTILE }),
    block('tab', 'table', { label: HOSTILE, columns: [{ id: 'a', name: HOSTILE }] }),
    {
      ...block('row', 'row', {}),
      parent: 'tab',
      cells: { a: HOSTILE },
    },
    block('w', 'work-bundle', {
      page: HOSTILE,
      number: HOSTILE,
      work: HOSTILE,
      tickets: [
        { label: HOSTILE, href: 'javascript:alert(1)' },
        { label: HOSTILE, href: HOSTILE },
      ],
    }),
    block('v', 'page-view', {
      label: HOSTILE,
      groupBy: HOSTILE,
      density: HOSTILE,
      columns: [HOSTILE],
      filters: [{ field: 'project', value: HOSTILE }],
      rows: [
        {
          id: HOSTILE,
          name: HOSTILE,
          stage: HOSTILE,
          author: HOSTILE,
          access: HOSTILE,
          updated: HOSTILE,
          projects: [HOSTILE],
          href: 'javascript:alert(1)',
        },
      ],
    }),
    block('live', 'page-view', { label: HOSTILE }),
    block('q', 'question', { agent: HOSTILE, choices: [HOSTILE] }, { text: HOSTILE }),
    block('i', 'image', { images: [{ src: 'javascript:alert(1)', alt: HOSTILE }] }),
    block('m', 'mockup', { markup: `<script>alert(1)</script>${HOSTILE}` }),
  ];
  const markup = renderToStaticMarkup(
    createElement(StructuredPage, { tree: new BlockTree(records), readonly: true }),
  );
  // Every part drew.
  for (const record of records)
    if (record.type !== 'row') expect(markup, record.id).toContain(`data-block-id="${record.id}"`);
  // No element a writer could have made.
  expect(markup).not.toMatch(/<(script|img|iframe|object|embed|style|link|base|form)\b/i);
  const attributes = [...markup.matchAll(/\s([^\s=<>"']+)="([^"]*)"/g)].map(([, name, value]) => ({
    name: name!,
    value: value!,
  }));
  for (const { name, value } of attributes) {
    // No handler, and no attribute named by a writer.
    expect(name, name).not.toMatch(/^on/i);
    // `script` only as a word's start: `aria-roledescription` (the DS carousel) is not a writer's.
    expect(name, name).not.toMatch(/evil|alert|\bscript/i);
    // A text attribute (an accessible name, a title) holds a writer's text escaped; nothing a
    // writer chose reaches a URL, a style or a class.
    if (URL_ATTRIBUTES.has(name))
      expect(value, `${name}="${value}"`).toMatch(/^(https?:\/\/|mailto:|#)[^"<>\s]*$/);
    if (name === 'class' || name === 'style')
      expect(value, name).not.toMatch(/evil|alert|red|url\(|expression\(/);
  }
  // The text itself is there, escaped.
  expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
});
