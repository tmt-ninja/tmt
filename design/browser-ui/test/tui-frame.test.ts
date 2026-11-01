import { describe, expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cells, color, oracle, selectFrame, states, styleFor } from '../docs/tui/model.js';

const root = new URL('../../../', import.meta.url);
describe('real TUI oracle rendering', () => {
  it('keeps source hashes and extracted cells equal to the frozen painter', () => {
    for (const source of oracle.provenance)
      expect(
        createHash('sha256')
          .update(readFileSync(new URL(source.path, root)))
          .digest('hex'),
        source.path,
      ).toBe(source.sha256);
    const raw = JSON.parse(readFileSync(new URL(oracle.provenance[0]!.path, root), 'utf8'));
    for (const frame of oracle.frames) {
      const source = raw.frames.find(
        (value: typeof frame) =>
          value.state === frame.state &&
          value.look === frame.look &&
          value.width === frame.width &&
          value.height === frame.height,
      );
      expect(source, frame.state).toBeDefined();
      expect(frame.lines).toEqual(source.lines.map((id: number) => raw.line_dictionary[id]));
      expect(frame.styles).toEqual(source.styles.map((id: number) => raw.style_row_dictionary[id]));
    }
    for (const [id, value] of Object.entries(oracle.styles)) expect(value).toBe(raw.styles[id]);
  });
  it('renders every source cell with contiguous styles and complete geometry', () => {
    for (const frame of oracle.frames) {
      expect(frame.lines).toHaveLength(frame.height);
      expect(frame.styles).toHaveLength(frame.height);
      for (let row = 0; row < frame.height; row++) {
        const result = cells(frame, row);
        expect(result).toHaveLength(frame.width);
        expect(
          result
            .map((cell) => cell.text)
            .join('')
            .trimEnd(),
        ).toBe(frame.lines[row]);
        expect(result.every((cell) => Object.hasOwn(oracle.styles, cell.style))).toBe(true);
      }
    }
    for (const id of Object.keys(oracle.styles)) {
      expect(styleFor(id, false).color).toBeTruthy();
      expect(styleFor(id, true).backgroundColor).toBeTruthy();
    }
  });
  it('preserves truecolor, ANSI16, reverse and no-color', () => {
    expect(color('Rgb(122, 162, 247)', 'fallback')).toBe('rgb(122, 162, 247)');
    expect(color('Indexed(4)', 'fallback')).toBe(oracle.ansiRgb[4]);
    expect(color('Reset', 'terminal default')).toBe('terminal default');
    expect(() => color('Indexed(200)', 'fallback')).toThrow('Unsupported');
    const reverse = Object.entries(oracle.styles).find(([, value]) => value.includes('REVERSED'))!;
    expect(styleFor(reverse[0], false).backgroundColor).toBeTruthy();
    const noColor = selectFrame('agents', 'NO_COLOR')!;
    for (let row = 0; row < noColor.height; row++)
      for (const cell of cells(noColor, row))
        expect(oracle.styles[cell.style as keyof typeof oracle.styles]).not.toContain('Rgb(');
  });
  it('selects real state/size combinations and refuses unknown states', () => {
    for (const state of states)
      for (const look of ['tmt', 'tmt-light', 'terminal', 'NO_COLOR']) {
        const frame = selectFrame(state, look);
        expect(frame, `${state}/${look}`).toBeDefined();
        expect(selectFrame(state, look, `${frame!.width}x${frame!.height}`)).toBe(frame);
      }
    expect(selectFrame('invented', 'tmt')).toBeUndefined();
  });
  it('keeps docs CSS token-only and terminal input inert', () => {
    for (const path of ['docs/tui/tui.css', 'docs/mock-tui/mock-tui.css'])
      expect(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')).not.toMatch(
        /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(/i,
      );
    const renderer = readFileSync(new URL('../docs/tui/frame.tsx', import.meta.url), 'utf8');
    expect(renderer).toContain("'tmt-tui-frame'");
    expect(renderer).toContain('span.textContent = cell.text');
    expect(renderer).not.toMatch(/innerHTML|fetch\(|WebSocket|addEventListener/);
  });
});
