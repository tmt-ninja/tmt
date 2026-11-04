import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DsScope } from '../ui/index.js';

export interface MockupBlockProps {
  system?: string;
  version?: string;
  width?: number;
  height?: number;
  theme?: 'light' | 'dark' | 'viewer';
  unavailable?: boolean;
  children?: ReactNode;
}

/** A sized, locally contained stage; the caller resolves the requested system and its version. */
export function MockupBlock({
  system = 'tmt-gui',
  version = 'follow',
  width = 390,
  height = 640,
  theme = 'viewer',
  unavailable = false,
  children,
}: MockupBlockProps) {
  const [stageWidth, setStageWidth] = useState(width);
  const [appearance, setAppearance] = useState(theme);
  const [custom, setCustom] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(width);
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = () => setAvailableWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [unavailable]);
  const scale = Math.min(1, availableWidth / Math.max(stageWidth, 1));
  const choose = (next: number) => {
    setCustom(false);
    setStageWidth(next);
  };
  return (
    <section className="tmt-block-mockup" aria-label={`${system} mockup`}>
      <div className="tmt-block-mockup-toolbar" role="toolbar" aria-label="Mockup settings">
        <span>
          {system}@{version}
        </span>
        <button
          type="button"
          aria-pressed={!custom && stageWidth === 390}
          onClick={() => choose(390)}
        >
          390
        </button>
        <button
          type="button"
          aria-pressed={!custom && stageWidth === 1440}
          onClick={() => choose(1440)}
        >
          1440
        </button>
        <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>
          Custom
        </button>
        {custom && (
          <input
            aria-label="Stage width"
            type="number"
            min={1}
            max={4096}
            value={stageWidth}
            onChange={(event) =>
              setStageWidth(Math.max(1, Math.min(4096, Number(event.target.value) || 1)))
            }
          />
        )}
        <button
          type="button"
          aria-pressed={appearance === 'light'}
          onClick={() => setAppearance('light')}
        >
          Light
        </button>
        <button
          type="button"
          aria-pressed={appearance === 'dark'}
          onClick={() => setAppearance('dark')}
        >
          Dark
        </button>
      </div>
      {unavailable ? (
        <p role="status">This design system version is not available.</p>
      ) : (
        <div
          className="tmt-block-mockup-viewport"
          ref={viewport}
          style={{ height: height * scale }}
        >
          <DsScope
            className="tmt-block-mockup-stage"
            style={{ width: stageWidth, height, transform: `scale(${scale})` }}
          >
            <div data-theme={appearance === 'viewer' ? undefined : appearance}>{children}</div>
          </DsScope>
        </div>
      )}
      {scale < 1 && (
        <span className="tmt-block-mockup-scale">Scaled {Math.round(scale * 100)}%</span>
      )}
    </section>
  );
}
