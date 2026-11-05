import { expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';

const tokens = JSON.parse(
  readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'),
);
const { ref } = tokens.browser;
const palette = tokens.browser;
it('keeps the primitive tier to raw values', () => {
  for (const [name, value] of Object.entries(ref))
    if (!name.startsWith('$'))
      expect(String(value), name).toMatch(/^(#[0-9a-f]{6}([0-9a-f]{2})?|\d+px)$/);
});

it('keeps status colours distinct from the accent in both themes', () => {
  for (const theme of ['light', 'dark'] as const)
    for (const role of ['working', 'waiting', 'review', 'blocked'])
      expect(palette.color[role][theme], `${theme} ${role}`).not.toBe(palette.color.accent[theme]);
  expect(tokens.browser['palette-b']).toBeUndefined();
});

it('keeps the docs and the Colab mock free of literal colours', () => {
  for (const file of [
    'docs.css',
    'mock-colab.css',
    'mock-reader.css',
    'mock-list.css',
    // #5835: the TUI docs and mock (gui-3).
    'tui/tui.css',
    'mock-tui/mock-tui.css',
  ]) {
    const css = readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(css, file).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(/i);
  }
});

it('uses the selected palette in standalone UI islands without a palette attribute', () => {
  const css = readFileSync(new URL('../generated/ui.css', import.meta.url), 'utf8');
  const resolve = (value: string) => value.replace(/\{([\w-]+)\}/g, (_, name: string) => ref[name]);
  expect(css).not.toContain('data-tmt-palette');
  for (const theme of ['light', 'dark'] as const) {
    expect(css).toContain(
      `--tmt-foundation-primary: ${resolve(palette.color['accent-fill'][theme])};`,
    );
    expect(css).toContain(`--tmt-foundation-foreground: ${resolve(palette.color.text[theme])};`);
    expect(css).toContain(`--tmt-foundation-background: ${resolve(palette.surface.paper[theme])};`);
  }
  expect(css).toContain('--tmt-foundation-radius: var(--tmt-ui-radius,');
});

it('keeps body text, status words and visible control marks legible in both themes', () => {
  function luminance(value: string) {
    const hex = value.replace(/\{([\w-]+)\}/g, (_, name: string) => ref[name]);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const linear = channels.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  }
  function contrast(foreground: string, background: string) {
    const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (hi! + 0.05) / (lo! + 0.05);
  }
  for (const theme of ['light', 'dark'] as const) {
    for (const role of ['text', 'secondary', 'text-action'])
      for (const background of ['paper', 'sheet'])
        expect(
          contrast(palette.color[role][theme], palette.surface[background][theme]),
          `${theme} ${role} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
    for (const role of ['working', 'waiting', 'review', 'blocked'])
      for (const background of ['sheet', `${role}-soft`])
        expect(
          contrast(palette.color[role][theme], palette.surface[background][theme]),
          `${theme} ${role} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
    for (const role of ['focus', 'edge'])
      for (const background of ['paper', 'sheet'])
        expect(
          contrast(palette.color[role][theme], palette.surface[background][theme]),
          `${theme} ${role} on ${background}`,
        ).toBeGreaterThanOrEqual(3);
    expect(
      contrast(palette.color['on-accent'][theme], palette.color['accent-fill'][theme]),
      `${theme} primary fill`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});
