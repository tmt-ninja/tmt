import { expect, it, vi } from 'vite-plus/test';

it('builds TUI navigation without loading the frame model', async () => {
  vi.resetModules();
  vi.doMock('../docs/tui/model.js', () => {
    throw new Error('TUI navigation loaded the frame model');
  });
  try {
    const { tuiPages } = await import('../docs/tui-nav.js');
    expect(tuiPages.some((page) => page.slug === 'roles' && page.group === 'Foundations')).toBe(
      true,
    );
    expect(tuiPages.some((page) => page.slug === 'list' && page.group === 'Components')).toBe(true);
    expect(tuiPages.some((page) => page.slug === 'agents-board' && page.group === 'Patterns')).toBe(
      true,
    );
  } finally {
    vi.doUnmock('../docs/tui/model.js');
    vi.resetModules();
  }
});

it('keeps navigation and the lazily loaded TUI pages in the same order', async () => {
  const nav = await import('../docs/tui-nav.js');
  const views = await import('../docs/tui/index.js');
  const metadata = (page: { slug: string; title: string; lead: string; group: string }) => ({
    slug: page.slug,
    title: page.title,
    lead: page.lead,
    group: page.group,
  });
  expect(nav.tuiPages.map(metadata)).toEqual(views.tuiPages.map(metadata));
});
