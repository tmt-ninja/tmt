/** Read-only extraction of real Ops painter fixtures, run at build time by oracle-module.mjs. Never
 * records or changes the Rust oracle. */
import { readFileSync } from 'node:fs';
export const root = new URL('../../../../', import.meta.url);
const oraclePath = 'extensions/tmt-ops/rust/tmt-ops/src/board/home/tests/oracle.json';
const themePath = 'rust/crates/tmt-cli-style/src/theme.rs';
/** Every file extract() reads. ci-scope.mjs selects the browser_ui audits for each of them. */
export const sources = [oraclePath, themePath, 'design/tokens/tokens.json'];
const read = (path) => readFileSync(new URL(path, root), 'utf8');
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
  'conversation-loading',
  'usage-disabled-each',
  'mention-picker',
  'frame-live',
  'frame-connecting',
];
/** The listed scenes from the Ops oracle. A listed scene the oracle no longer records fails here, so
 * the Ops change that renames or drops it fails its own browser_ui audits. */
export function extract(oracle = JSON.parse(read(oraclePath))) {
  const missing = scenes.filter((scene) => !oracle.frames.some((frame) => frame.state === scene));
  if (missing.length)
    throw new Error(`The Ops oracle (${oraclePath}) has no frames for: ${missing.join(', ')}`);
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
      frame.styles.flatMap((row) => [...row.matchAll(/=(s\d+)/g)].map((match) => match[1]))
    )
  );
  const tokens = JSON.parse(read('design/tokens/tokens.json'));
  const theme = read(themePath);
  const ansi = theme.match(/const ANSI_RGB:[\s\S]*?= \[([\s\S]*?)\];/)?.[1];
  if (ansi === undefined)
    throw new Error(`${themePath}: no \`const ANSI_RGB: … = [ … ];\` table found`);
  const ansiRgb = [...ansi.matchAll(/\((\d+), (\d+), (\d+)\)/g)].map(
    (m) => `rgb(${m[1]}, ${m[2]}, ${m[3]})`
  );
  const lineDictionary = [...new Set(frames.flatMap((frame) => frame.lines))];
  const styleDictionary = [...new Set(frames.flatMap((frame) => frame.styles))];
  return {
    sources,
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
