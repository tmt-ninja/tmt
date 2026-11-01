/** Read-only extraction of real Ops painter fixtures. Never records or changes the Rust oracle. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../../../', import.meta.url);
const oraclePath = 'extensions/tmt-ops/rust/tmt-ops/src/board/home/tests/oracle.json';
const themePath = 'rust/crates/tmt-cli-style/src/theme.rs';
const stylePath = 'rust/crates/tmt-tui/src/style.rs';
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const hash = (text) => createHash('sha256').update(text).digest('hex');
// These scenes select the real Agents workspace, including its overlays and retained data states.
export const scenes = [
  'overview',
  'agents',
  'agents-sorted',
  'agents-state-sorted',
  'agents-header-hover',
  'empty',
  'pool',
  'dense',
  'squads-eight',
  'squads-thirty-six',
  'partial',
  'stale',
  'help',
  'review',
  'result',
  'conversation',
  'composer-empty',
  'composer-2',
  'composer-6',
  'composer-8',
  'header-usage',
  'unread-working',
  'unread-idle',
  'unread-waiting',
  'unread-squads',
  'unread-cleared',
  'idle-alert',
  'idle-alert-overview',
  'measure-agent',
  'measure-squad',
  'measure-agents-chip',
  'search-agents-all-matches',
  'search-agents-all-empty',
  'search-agents-pinned-matches',
  'search-agents-pinned-empty',
  'settings-menu',
  'squad-settings',
  'bindings-list',
  'bindings-preview',
  'bindings-unavailable',
];
export function extract() {
  const raw = read(oraclePath);
  const oracle = JSON.parse(raw);
  const frames = oracle.frames
    .filter((frame) => scenes.includes(frame.state))
    .map((frame) => ({
      state: frame.state,
      look: frame.look,
      width: frame.width,
      height: frame.height,
      // Exactly the frozen decoder's dictionary expansion; no cell text or style is rewritten.
      lines: frame.lines.map((id) => oracle.line_dictionary[id]),
      styles: frame.styles.map((id) => oracle.style_row_dictionary[id]),
    }));
  const used = new Set(
    frames.flatMap((frame) =>
      frame.styles.flatMap((row) => [...row.matchAll(/=(s\d+)/g)].map((match) => match[1])),
    ),
  );
  const tokens = JSON.parse(read('design/tokens/tokens.json'));
  const theme = read(themePath);
  const ansi = theme.match(/const ANSI_RGB:[\s\S]*?= \[([\s\S]*?)\];/)[1];
  const ansiRgb = [...ansi.matchAll(/\((\d+), (\d+), (\d+)\)/g)].map(
    (m) => `rgb(${m[1]}, ${m[2]}, ${m[3]})`,
  );
  const lineDictionary = [...new Set(frames.flatMap((frame) => frame.lines))];
  const styleDictionary = [...new Set(frames.flatMap((frame) => frame.styles))];
  return {
    provenance: [oraclePath, themePath, stylePath, 'design/tokens/tokens.json'].map((path) => ({
      path,
      sha256: hash(read(path)),
    })),
    ansiRgb,
    roles: tokens.color,
    marks: tokens.mark,
    // The terminal owns Reset colors. Use explicit browser preview defaults, never palette B.
    defaults: {
      dark: { fg: tokens.color.text.dark, bg: tokens.surface.term.dark },
      light: { fg: tokens.color.text.light, bg: tokens.surface.paper.light },
    },
    styles: Object.fromEntries(Object.entries(oracle.styles).filter(([id]) => used.has(id))),
    lineDictionary,
    styleDictionary,
    frames: frames.map((frame) => ({
      ...frame,
      lines: frame.lines.map((line) => lineDictionary.indexOf(line)),
      styles: frame.styles.map((line) => styleDictionary.indexOf(line)),
    })),
  };
}
if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const target = new URL('./data/oracle.json', import.meta.url);
  const text = JSON.stringify(extract()) + '\n';
  if (process.argv.includes('--check')) {
    if (JSON.stringify(JSON.parse(readFileSync(target, 'utf8'))) !== JSON.stringify(extract()))
      throw new Error('TUI docs oracle is stale; run docs/tui/generate.mjs');
  } else writeFileSync(target, text);
}
