import { describe, expect, it } from 'vite-plus/test';
import { designPageRouting } from '../src/design-page.js';
import type { PageRouting } from '../src/page-routing.js';

// #5961 review: a Design page's links, at both Design mounts.
const system = {
  id: 'root',
  tree: {
    id: 'root',
    title: 'Acme',
    kind: 'design-system' as const,
    children: [{ id: 'button', title: 'Button', kind: 'component' as const, children: [] }],
  },
};
function routing(base: string) {
  const calls: string[] = [];
  const colab = {
    open: (route: string, anchor?: string) => calls.push(`colab ${route} ${anchor ?? ''}`.trim()),
    pageHref: (id: string) => `/pages/${id}`,
  } as unknown as PageRouting;
  const routed = designPageRouting(colab, system, base, {
    navigate: (href) => calls.push(`design ${href}`),
    leave: (href) => calls.push(`leave ${href}`),
  });
  return { routed, calls };
}

describe('Design page links', () => {
  it('keeps tree pages in Design with their anchor at either mount', () => {
    for (const base of ['/design', '/colab/design']) {
      const { routed, calls } = routing(base);
      routed.open('/pages/button', 'button:primary');
      expect(calls).toEqual([`design ${base}/systems/root/button#button%3Aprimary`]);
      expect(routed.pageHref('button')).toBe(`${base}/systems/root/button`);
    }
  });
  it('opens other pages at their Colab address under the root /design mount', () => {
    const { routed, calls } = routing('/design');
    routed.open('/pages/note', 'intro');
    expect(calls).toEqual(['leave /colab/pages/note?anchor=intro']);
    expect(routed.pageHref('note')).toBe('/colab/pages/note');
    expect(routed.pageHref('note', { read: 'r1' })).toBe('/colab/pages/note?read=r1');
  });
  it('leaves other pages to Colab routing under its own mount', () => {
    const { routed, calls } = routing('/colab/design');
    routed.open('/pages/note');
    expect(calls).toEqual(['colab /pages/note']);
    expect(routed.pageHref('note')).toBe('/pages/note');
  });
});
