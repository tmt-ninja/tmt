import { describe, expect, it } from 'vitest';
import { newPageId } from '../src/management.js';
import {
  catalogOrder,
  createCommand,
  pickerOrder,
  validateListing,
  type TemplateEntry,
} from '../src/templates.js';

const entry = (name: string, extra: Partial<TemplateEntry> = {}): TemplateEntry => ({
  name,
  layout: 'column',
  summary: `${name} summary`,
  source: 'builtIn',
  default: false,
  usedBy: 0,
  ...extra,
});
const space = (name: string, n: number, extra: Partial<TemplateEntry> = {}) =>
  entry(name, {
    source: 'space',
    id: `d000000${n}-1111-4111-8111-000000000001`,
    author: 'ben',
    ...extra,
  });

describe('templates (#5077)', () => {
  it('names a new page as the owner does', async () => {
    // The same vector as subpage_create.rs `a_new_page_is_named_by_its_operation_in_its_own_domain`.
    expect(await newPageId('s'.repeat(43), '60000000-0000-4000-8000-000000000001')).toBe(
      '0ac15bfb-9bf1-4385-990f-ab16d9fcaad7',
    );
  });

  it('admits only the listing shape the owner answers', () => {
    const good = {
      default: 'starter',
      templates: [entry('starter', { default: true }), space('weekly-review', 1)],
    };
    expect(() => validateListing(good)).not.toThrow();
    expect(() => validateListing({ ...good, defaultGone: 'old' })).not.toThrow();
    for (const bad of [
      { ...good, extra: 1 },
      { ...good, default: 'report' },
      { ...good, templates: [entry('starter'), space('weekly-review', 1)] },
      { ...good, templates: [entry('starter', { default: true }), entry('Bad Name')] },
      { ...good, templates: [entry('starter', { default: true, id: 'x' })] },
      {
        ...good,
        templates: [entry('starter', { default: true }), space('w', 1, { id: undefined })],
      },
      { ...good, templates: [entry('starter', { default: true, usedBy: -1 })] },
      { ...good, templates: [entry('starter', { default: true, layout: 'wide' as never })] },
    ])
      expect(() => validateListing(JSON.parse(JSON.stringify(bad)))).toThrow();
  });

  it('orders the default first, then TMT, then this space; the picker adds the last used', () => {
    const all = [
      entry('starter'),
      entry('report'),
      space('weekly-review', 1, { default: true }),
      space('design-proposal', 2),
      entry('board'),
    ];
    expect(catalogOrder(all).map((t) => t.name)).toEqual([
      'weekly-review',
      'starter',
      'report',
      'board',
      'design-proposal',
    ]);
    expect(
      pickerOrder(all, ['design-proposal', 'weekly-review', 'board', 'report', 'starter']).map(
        (t) => t.name,
      ),
    ).toEqual(['weekly-review', 'design-proposal', 'board', 'report', 'starter']);
  });

  it('gives the terminal command for the chosen template, with none for the default', () => {
    expect(createCommand('Week 43', entry('starter', { default: true }))).toBe(
      'tmt colab page create --title "Week 43"',
    );
    expect(createCommand('Say "hi" $x', space('weekly-review', 1))).toBe(
      'tmt colab page create --title "Say \\"hi\\" \\$x" --template weekly-review',
    );
    expect(createCommand('  ', undefined)).toBe('tmt colab page create --title "Notes"');
  });
});
