import { describe, expect, it } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlockMenu } from '../src/blocks/index.js';

/** #5981: the block-menu tag names catalog rows by label or `id:text`; BlockMenu draws them from the one catalog. */
const markup = (props: Parameters<typeof BlockMenu>[0]) =>
  renderToStaticMarkup(<BlockMenu {...props} />);
const text = (html: string | undefined) => html?.replace(/<[^>]+>/g, '');
/** Each row's parts, read from the static markup: the row element up to the next row or group. */
const rows = (html: string) =>
  html
    .split(/(?=<div data-slot="block-menu-item")/)
    .slice(1)
    .map((row) => {
      const open = row.slice(0, row.indexOf('>'));
      const label = /<span class="tmt-block-menu-label">(.*?)(?:<small|<\/span>)/.exec(row)?.[1];
      return {
        label: text(label),
        description: text(
          /<small class="tmt-block-menu-description">(.*?)<\/small>/.exec(row)?.[1],
        ),
        shortcut: text(/<kbd class="tmt-block-kbd">(.*?)<\/kbd>/.exec(row)?.[1]),
        icon: /^<div data-slot="block-menu-item"[^>]*><span class="tmt-block-menu-icon"[^>]*><svg/.test(
          row,
        ),
        active: open.includes('data-active'),
        danger: open.includes('data-danger'),
      };
    });
const all = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((match) => match[1]);

describe('BlockMenu catalog rows', () => {
  it('draws insert types with icon, description, shortcut and group headings, in the given order', () => {
    const doc = markup({
      label: 'Insert block',
      placement: 'sheet',
      items: ['code', 'Paragraph', ' Table ', 'Callout'],
      activeItem: 'table',
    });
    expect(rows(doc)).toEqual([
      {
        label: 'Code',
        description: 'A file or a command',
        shortcut: '```',
        icon: true,
        active: false,
        danger: false,
      },
      {
        label: 'Paragraph',
        description: 'Plain text',
        shortcut: '/text',
        icon: true,
        active: false,
        danger: false,
      },
      {
        label: 'Table',
        description: 'Columns and rows',
        shortcut: '/table',
        icon: true,
        active: true,
        danger: false,
      },
      // A label outside the catalog stays a plain row.
      {
        label: 'Callout',
        description: undefined,
        shortcut: undefined,
        icon: false,
        active: false,
        danger: false,
      },
    ]);
    expect(all(doc, /data-slot="block-menu-group"[^>]*>([^<]*)</g)).toEqual(['Structure', 'Basic']);
    expect(all(doc, /role="group" aria-label="([^"]*)"/g)).toEqual(['Structure', 'Basic']);
  });

  it('shows no heading when every catalog row is in one group', () => {
    const doc = markup({ label: 'Insert block', items: ['Paragraph', 'Heading'] });
    expect(doc).not.toContain('data-slot="block-menu-group"');
    expect(all(doc, /role="group" aria-label="([^"]*)"/g)).toEqual(['Basic']);
  });

  it('draws block actions with their keys, the danger mark and a rule before Delete', () => {
    const doc = markup({
      label: 'Block actions',
      kind: 'actions',
      items: ['Move up', 'Duplicate', 'Delete', 'Archive'],
      activeItem: 'Move up',
    });
    expect(rows(doc)).toEqual([
      {
        label: 'Move up',
        description: undefined,
        shortcut: '⌥⇧↑',
        icon: false,
        active: true,
        danger: false,
      },
      {
        label: 'Duplicate',
        description: undefined,
        shortcut: '⌘D',
        icon: false,
        active: false,
        danger: false,
      },
      {
        label: 'Delete',
        description: undefined,
        shortcut: 'Del',
        icon: false,
        active: false,
        danger: true,
      },
      {
        label: 'Archive',
        description: undefined,
        shortcut: undefined,
        icon: false,
        active: false,
        danger: false,
      },
    ]);
    expect(all(doc, /(data-slot="block-menu-separator")/g)).toHaveLength(1);
    expect(doc.indexOf('block-menu-separator')).toBeLessThan(doc.indexOf('>Delete<'));
    expect(doc.indexOf('block-menu-separator')).toBeGreaterThan(doc.indexOf('>Duplicate<'));
    expect(all(doc, /(role="menuitem")/g)).toHaveLength(4);
  });

  it('draws `id:text` entries as that catalog row with the given text, and renames groups', () => {
    const doc = markup({
      label: '插入區塊',
      items: ['group:basic:基本', 'group:structure:結構', 'text:段落', 'code:程式碼', 'table:表格'],
      activeItem: 'table',
    });
    expect(
      rows(doc).map(({ label, description, shortcut, icon, active }) => ({
        label,
        description,
        shortcut,
        icon,
        active,
      })),
    ).toEqual([
      { label: '段落', description: 'Plain text', shortcut: '/text', icon: true, active: false },
      {
        label: '程式碼',
        description: 'A file or a command',
        shortcut: '```',
        icon: true,
        active: false,
      },
      {
        label: '表格',
        description: 'Columns and rows',
        shortcut: '/table',
        icon: true,
        active: true,
      },
    ]);
    // Runs keep the given order: Basic, Structure, Basic again; each run is headed by its new name.
    expect(all(doc, /data-slot="block-menu-group"[^>]*>([^<]*)</g)).toEqual([
      '基本',
      '結構',
      '基本',
    ]);
    expect(doc).not.toContain('group:');
  });

  it('draws block actions by id with the given text and keeps their keys and danger mark', () => {
    const doc = markup({
      label: '區塊動作',
      kind: 'actions',
      items: ['duplicate:複製', 'delete:刪除'],
      activeItem: '刪除',
    });
    expect(rows(doc)).toEqual([
      {
        label: '複製',
        description: undefined,
        shortcut: '⌘D',
        icon: false,
        active: false,
        danger: false,
      },
      {
        label: '刪除',
        description: undefined,
        shortcut: 'Del',
        icon: false,
        active: true,
        danger: true,
      },
    ]);
    expect(all(doc, /(data-slot="block-menu-separator")/g)).toHaveLength(1);
  });

  it('draws malformed or unknown entries as plain rows with their own text and never throws', () => {
    const entries = [
      'nope:不明',
      'group:nope:不明',
      'group:basic:',
      ':空',
      'Text:大寫',
      'table:',
      '  ',
    ];
    const insert = markup({ label: 'Insert block', items: entries });
    expect(rows(insert).map((row) => [row.label, row.icon, row.shortcut])).toEqual([
      ['nope:不明', false, undefined],
      ['group:nope:不明', false, undefined],
      ['group:basic:', false, undefined],
      [':空', false, undefined],
      ['Text:大寫', false, undefined],
      ['table:', false, undefined],
    ]);
    expect(insert).not.toContain('data-slot="block-menu-group"');
    // A heading override is an insert-menu entry; an action menu shows it as text.
    const actions = markup({
      label: 'Block actions',
      kind: 'actions',
      items: ['group:basic:基本', 'nope:x'],
    });
    expect(rows(actions).map((row) => [row.label, row.shortcut])).toEqual([
      ['group:basic:基本', undefined],
      ['nope:x', undefined],
    ]);
  });

  it('keeps children after the catalog rows and draws none without items', () => {
    const doc = renderToStaticMarkup(
      <BlockMenu label="Insert block" items={['Paragraph']}>
        <footer>hints</footer>
      </BlockMenu>,
    );
    expect(doc).toMatch(/Plain text.*<footer>hints<\/footer><\/div>$/);
    expect(rows(markup({ label: 'Empty' }))).toEqual([]);
  });
});
