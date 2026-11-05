import { expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';

const tokens = JSON.parse(
  readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'),
);
const { ref, color, surface } = tokens.browser;
const palette = tokens.browser['palette-b'];
const reads = (value: string) => [...value.matchAll(/\{([\w-]+)\}/g)].map((match) => match[1]!);
const themed = (roles: Record<string, { dark: string; light: string }>) =>
  Object.entries(roles).filter(([name]) => !name.startsWith('$'));

it('keeps the primitive tier to raw values', () => {
  for (const [name, value] of Object.entries(ref))
    if (!name.startsWith('$'))
      expect(String(value), name).toMatch(/^(#[0-9a-f]{6}([0-9a-f]{2})?|\d+px)$/);
});

it('maps palette B onto existing roles, reading only refs that exist', () => {
  for (const [group, roles] of [
    ['color', palette.color],
    ['surface', palette.surface],
  ] as const)
    for (const [role, value] of themed(roles)) {
      expect(tokens.browser[group][role], `${group}.${role}`).toBeDefined();
      for (const name of [...reads(value.dark), ...reads(value.light)])
        expect(ref[name], `${group}.${role} reads ${name}`).toBeDefined();
    }
  for (const [role, value] of themed(palette.shadow)) {
    expect(tokens.browser.shadow[role], `shadow.${role}`).toBeDefined();
    for (const name of [...reads(value.dark), ...reads(value.light)])
      expect(ref[name], `shadow.${role} reads ${name}`).toBeDefined();
  }
  for (const [role, value] of themed(palette['brand-mark'])) {
    expect(tokens.brand.mark[role], `brand-mark.${role}`).toBeDefined();
    for (const name of [...reads(value.dark), ...reads(value.light)])
      expect(ref[name], `brand-mark.${role} reads ${name}`).toBeDefined();
  }
  for (const [role, value] of Object.entries(palette.metric) as [string, string][]) {
    expect(tokens.browser.metric[role], role).toBeDefined();
    for (const name of reads(value)) expect(ref[name], `${role} reads ${name}`).toBeDefined();
  }
  // Chart series and seats are data colours, not the palette: B leaves them as they are.
  expect(Object.keys(palette.color).some((role) => /^(series|seat)-/.test(role))).toBe(false);
  expect(color).toBeDefined();
  expect(surface).toBeDefined();
});

it('never colours a state with the accent primitive', () => {
  const accent = new Set(
    ['accent', 'accent-strong'].flatMap((role) => [
      ...reads(palette.color[role].dark),
      ...reads(palette.color[role].light),
    ]),
  );
  expect(accent.size).toBeGreaterThan(0);
  const status = [
    ...['working', 'waiting', 'review', 'blocked', 'focus-destructive'].map(
      (role) => palette.color[role],
    ),
    ...['working-soft', 'waiting-soft', 'review-soft', 'blocked-soft'].map(
      (role) => palette.surface[role],
    ),
  ];
  for (const value of status)
    for (const name of [...reads(value.dark), ...reads(value.light)]) {
      expect(accent.has(name), name).toBe(false);
      expect(ref[name], name).not.toBe(ref['red-500']);
    }
});

it('maps every colour and surface role, so nothing under B falls back to the old palette', () => {
  // Chart series and seats are data colours, kept on purpose; elevation-0 is no shadow at all.
  for (const group of ['color', 'surface'] as const)
    for (const role of Object.keys(tokens.browser[group]).filter(
      (name) => !name.startsWith('$') && !/^(series|seat)-/.test(name),
    ))
      expect(palette[group][role], `${group}.${role}`).toBeDefined();
  for (const role of Object.keys(tokens.browser.shadow).filter(
    (name) => !name.startsWith('$') && name !== 'elevation-0',
  ))
    expect(palette.shadow[role], `shadow.${role}`).toBeDefined();
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
