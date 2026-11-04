import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, DsScope, UiTheme } from '../ui/index.js';

export interface MockupBlockProps {
  system?: string;
  version?: string;
  width?: number;
  height?: number;
  theme?: 'light' | 'dark' | 'viewer';
  unavailable?: boolean;
  systems?: readonly { id: string; name: string; versions: readonly string[] }[];
  onSystemChange?(system: string): void;
  onVersionChange?(version: string): void;
  onSettingsChange?(settings: { width: number; theme: 'light' | 'dark' | 'viewer' }): void;
  children?: ReactNode;
}

const boundedWidth = (width: number) =>
  Number.isFinite(width) ? Math.max(1, Math.min(4096, Math.round(width))) : 390;

/** A sized, locally contained stage; the caller resolves the requested system and its version. */
export function MockupBlock({
  system = 'tmt-gui',
  version = 'follow',
  width = 390,
  height = 640,
  theme = 'viewer',
  unavailable = false,
  systems = [],
  onSystemChange,
  onVersionChange,
  onSettingsChange,
  children,
}: MockupBlockProps) {
  const [stageWidth, setStageWidth] = useState(() => boundedWidth(width));
  const [appearance, setAppearance] = useState(theme);
  const [custom, setCustom] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(() => boundedWidth(width));
  useEffect(() => setStageWidth(boundedWidth(width)), [width]);
  useEffect(() => setAppearance(theme), [theme]);
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
  const scale = stageWidth <= 390 ? 1 : Math.min(1, availableWidth / Math.max(stageWidth, 1));
  const choose = (next: number) => {
    setCustom(false);
    setStageWidth(next);
    onSettingsChange?.({ width: next, theme: appearance });
  };
  return (
    <div className="tmt-block-mockup-host">
      <UiTheme>
        <section className="tmt-block-mockup" aria-label={`${system} mockup`}>
          <div className="tmt-block-mockup-toolbar" role="toolbar" aria-label="Mockup settings">
            {systems.length ? (
              <>
                <select
                  aria-label="Design system"
                  value={system}
                  disabled={!onSystemChange}
                  onChange={(event) => onSystemChange?.(event.target.value)}
                >
                  {systems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Design system version"
                  value={version}
                  disabled={!onVersionChange}
                  onChange={(event) => onVersionChange?.(event.target.value)}
                >
                  <option value="follow">Follow draft</option>
                  {systems
                    .find((item) => item.id === system)
                    ?.versions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <span>
                {system}@{version}
              </span>
            )}
            <Button
              variant="outline"
              size="xs"
              type="button"
              aria-pressed={!custom && stageWidth === 390}
              onClick={() => choose(390)}
            >
              390
            </Button>
            <Button
              variant="outline"
              size="xs"
              type="button"
              aria-pressed={!custom && stageWidth === 1440}
              onClick={() => choose(1440)}
            >
              1440
            </Button>
            <Button
              variant="outline"
              size="xs"
              type="button"
              aria-pressed={custom}
              onClick={() => setCustom(true)}
            >
              Custom
            </Button>
            {custom && (
              <input
                aria-label="Stage width"
                type="number"
                min={1}
                max={4096}
                value={stageWidth}
                onChange={(event) => {
                  const next = Math.max(1, Math.min(4096, Number(event.target.value) || 1));
                  setStageWidth(next);
                  onSettingsChange?.({ width: next, theme: appearance });
                }}
              />
            )}
            <Button
              variant="outline"
              size="xs"
              type="button"
              aria-pressed={appearance === 'light'}
              onClick={() => {
                setAppearance('light');
                onSettingsChange?.({ width: stageWidth, theme: 'light' });
              }}
            >
              Light
            </Button>
            <Button
              variant="outline"
              size="xs"
              type="button"
              aria-pressed={appearance === 'dark'}
              onClick={() => {
                setAppearance('dark');
                onSettingsChange?.({ width: stageWidth, theme: 'dark' });
              }}
            >
              Dark
            </Button>
            <Button
              variant="outline"
              size="xs"
              type="button"
              aria-pressed={appearance === 'viewer'}
              onClick={() => {
                setAppearance('viewer');
                onSettingsChange?.({ width: stageWidth, theme: 'viewer' });
              }}
            >
              Viewer
            </Button>
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
      </UiTheme>
    </div>
  );
}
