import { createElement, useLayoutEffect, useRef } from 'react';
import { cells, oracle, styleFor, type Frame } from './model.js';

/** Docs-only renderer of frozen painter cells. No TUI input or action is dispatched. */
export function registerTuiFrame() {
  if (customElements.get('tmt-tui-frame')) return;
  customElements.define(
    'tmt-tui-frame',
    class extends HTMLElement {
      set frame(frame: Frame) {
        const fragment = document.createDocumentFragment();
        for (let row = 0; row < frame.height; row++) {
          const line = document.createElement('div');
          line.className = 'tui-frame-row';
          for (const cell of cells(frame, row)) {
            const span = document.createElement('span');
            span.textContent = cell.text;
            Object.assign(span.style, styleFor(cell.style, frame.look === 'tmt-light'));
            line.append(span);
          }
          fragment.append(line);
        }
        this.replaceChildren(fragment);
        const defaults = oracle.defaults[frame.look === 'tmt-light' ? 'light' : 'dark'];
        this.style.backgroundColor = defaults.bg;
        this.style.color = defaults.fg;
        this.style.width = `${frame.width}ch`;
        this.dataset.state = frame.state;
        this.dataset.look = frame.look;
        this.dataset.columns = String(frame.width);
        this.dataset.rows = String(frame.height);
      }
    },
  );
}
export function TuiFrame({
  frame,
  label,
  crop,
}: {
  frame: Frame;
  label?: string;
  crop?: [number, number];
}) {
  const ref = useRef<HTMLElement & { frame: Frame }>(null);
  useLayoutEffect(() => {
    registerTuiFrame();
    // Crops are whole original rows; never rewrite text or style runs.
    ref.current!.frame = crop
      ? {
          ...frame,
          height: crop[1] - crop[0],
          lines: frame.lines.slice(...crop),
          styles: frame.styles.slice(...crop),
        }
      : frame;
  }, [frame, crop]);
  return (
    <figure className="tui-figure">
      <figcaption>
        {label ?? frame.state}{' '}
        <span className="docs-muted">
          {frame.width} × {crop ? crop[1] - crop[0] : frame.height} cells · {frame.look}
          {crop ? ` · source rows ${crop[0] + 1}–${crop[1]}` : ''}
        </span>
      </figcaption>
      <div
        className="tui-frame-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${label ?? frame.state} terminal frame, horizontally scrollable`}
      >
        {createElement('tmt-tui-frame', {
          ref,
          role: 'img',
          'aria-label': `${label ?? frame.state}, ${frame.width} columns, ${frame.height} rows`,
        })}
      </div>
    </figure>
  );
}
