import { describe, expect, it } from 'vite-plus/test';
import { inProjects, scopeRows } from '../src/project-scope.js';
import type { PageSummary } from '../src/transport.js';

const page = (id: string, projects: string[], waiting = false): PageSummary => ({
  id,
  title: id,
  sharing: 'private',
  projects,
  summary: { comments: 0, waiting, needsYou: waiting ? 1 : 0 },
});
describe('project scope', () => {
  it('lists All pages first, then every project with its pages and the ones that wait', () => {
    const pages = [page('a', ['x', 'y'], true), page('b', ['x']), page('c', [], true)];
    expect(scopeRows(pages, ['empty', 'x', 'y'])).toEqual([
      { name: undefined, count: 3, waiting: 2 },
      { name: 'empty', count: 0, waiting: 0 },
      { name: 'x', count: 2, waiting: 1 },
      { name: 'y', count: 1, waiting: 1 },
    ]);
  });
  it('keeps the pages in every listed project, or every page without one', () => {
    const pages = [page('a', ['x', 'y']), page('b', ['y']), page('c', [])];
    expect(inProjects(pages, [])).toEqual(pages);
    expect(inProjects(pages, ['y']).map((p) => p.id)).toEqual(['a', 'b']);
    expect(inProjects(pages, ['x', 'y']).map((p) => p.id)).toEqual(['a']);
    expect(inProjects(pages, ['gone'])).toEqual([]);
  });
});
