import { expect, it } from 'vite-plus/test';
import { shellRail, type ShellAnswer, type ShellModule } from '@tmt/browser-ui/shell';
const origin = 'http://127.0.0.1:15866';
const colab: ShellModule = {
  extension: 'colab',
  rail: { label: 'Colab', icon: 'file-text', path: `${origin}/r/abc/x/colab/`, order: 100 },
  menu: [],
  settings: [],
  needsYou: 2,
};
it('makes Design a Colab-owned destination with its own rail label and no duplicated attention', () => {
  const answer: ShellAnswer = { version: 1, modules: [colab] };
  for (const host of [undefined, colab]) {
    const rail = shellRail(answer, { origin, href: `${origin}/colab/design/` }, host);
    expect(rail.main.find((item) => item.id === 'design')).toMatchObject({
      label: 'Design',
      icon: 'palette',
      href: `${origin}/colab/design/`,
      current: true,
    });
    expect(rail.main.find((item) => item.id === 'design')?.count).toBeUndefined();
    expect(rail.main.filter((item) => item.current).map((item) => item.id)).toEqual(['design']);
  }
});
it('inherits Colab availability and keeps normal Colab pages current', () => {
  const place = { origin, href: `${origin}/colab/design/tui/list` };
  expect(shellRail(undefined, place).main.find((item) => item.id === 'design')?.disabled).toBe(
    true,
  );
  const hosted = shellRail(undefined, place, colab).main;
  expect(hosted.find((item) => item.id === 'design')?.disabled).toBeUndefined();
  expect(hosted.filter((item) => item.current).map((item) => item.id)).toEqual(['design']);
  const normal = shellRail(undefined, { origin, href: `${origin}/colab/pages/p1` }, colab).main;
  expect(normal.filter((item) => item.current).map((item) => item.id)).toEqual(['colab']);
});
