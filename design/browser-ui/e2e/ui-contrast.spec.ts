import { expect, test } from '@playwright/test';

/** WCAG relative luminance of an sRGB colour given as "rgb(r, g, b)" or "rgba(r, g, b, a)". */
const luminance = ([r, g, b]: number[]) =>
  [r, g, b]
    .map((value) => value! / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
const ratio = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test('every Button variant and size keeps 4.5:1 text contrast in both palettes and themes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?frame=ui-contrast');
  const buttons = page.locator('[data-contrast]');
  await expect(buttons).toHaveCount(2 * 2 * 6 * 8);
  // Text colour over the background the button actually paints: its own fill composited over the
  // nearest painted ancestor, so a transparent ghost reads its surface.
  const samples = await buttons.evaluateAll((nodes) => {
    const parse = (value: string) => {
      const parts = value.match(/[\d.]+/g)!.map(Number);
      return { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 };
    };
    const over = (top: { rgb: number[]; alpha: number }, under: number[]) =>
      top.rgb.map((c, i) => c * top.alpha + under[i]! * (1 - top.alpha));
    const backdrop = (node: Element | null): number[] => {
      if (!node) return [255, 255, 255];
      const fill = parse(getComputedStyle(node).backgroundColor);
      return fill.alpha === 0
        ? backdrop(node.parentElement)
        : over(fill, backdrop(node.parentElement));
    };
    return nodes.map((node) => {
      const style = getComputedStyle(node);
      const background = backdrop(node);
      return {
        name: node.getAttribute('data-contrast')!,
        text: over(parse(style.color), background),
        background,
      };
    });
  });
  const failures = samples
    .map((sample) => ({ ...sample, contrast: ratio(sample.text, sample.background) }))
    .filter((sample) => sample.contrast < 4.5)
    .map((sample) => `${sample.name}: ${sample.contrast.toFixed(2)}`);
  expect(failures).toEqual([]);
});
