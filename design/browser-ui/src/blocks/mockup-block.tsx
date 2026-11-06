import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DsScope, UiTheme } from '../ui/index.js';

export interface MockupBlockProps {
  system?: string;
  version?: string;
  width?: number;
  /** The least stage height; the stage otherwise hugs its content. */
  height?: number;
  theme?: 'light' | 'dark' | 'viewer';
  /** No stage: true, or the reason shown instead (a page pin that does not match). */
  unavailable?: boolean | string;
  systems?: readonly { id: string; name: string; versions: readonly string[] }[];
  onSystemChange?(system: string): void;
  onVersionChange?(version: string): void;
  onSettingsChange?(settings: { width: number; theme: 'light' | 'dark' | 'viewer' }): void;
  children?: ReactNode;
}

/**
 * The stage height: its content's, at least `min`. A phone sheet sizes itself from the stage
 * (60cqh), so a stage holding one and no minimum takes the sheet's own height and never follows it.
 */
function mockupStageHeight(min: number, content: HTMLElement) {
  const sheet = content.querySelector<HTMLElement>('.tmt-block-menu[data-placement="sheet"]');
  const height = sheet
    ? min || Math.ceil((sheet.scrollHeight + sheet.offsetHeight - sheet.clientHeight) / 0.6)
    : Math.max(min, content.offsetHeight);
  return Math.min(4096, height);
}

const boundedWidth = (width: number) =>
  Number.isFinite(width) ? Math.max(1, Math.min(4096, Math.round(width))) : 390;

const themes = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['viewer', 'Viewer'],
] as const;

/** A sized, locally contained stage; the caller resolves the requested system and its version. */
export function MockupBlock({
  system = 'tmt-gui',
  version = 'follow',
  width = 390,
  height = 0,
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
  // A width other than the two presets opens as Custom.
  const [custom, setCustom] = useState(() => ![390, 1440].includes(boundedWidth(width)));
  const [availableWidth, setAvailableWidth] = useState(() => boundedWidth(width));
  useEffect(() => setStageWidth(boundedWidth(width)), [width]);
  useEffect(() => setAppearance(theme), [theme]);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const min = Number.isFinite(height) ? Math.max(0, Math.min(2000, height)) : 0;
  const [stageHeight, setStageHeight] = useState(min);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const update = () => setStageHeight(mockupStageHeight(min, node));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [min, stageWidth, unavailable]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = () => setAvailableWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [unavailable]);
  // A stage wider than its block, at any width, scales down to fit; it never scrolls sideways.
  const scale = Math.min(1, availableWidth / Math.max(stageWidth, 1));
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
              <span className="tmt-block-mockup-pin" title={`${system}@${version}`}>
                {system}@{version}
              </span>
            )}
            <div className="tmt-block-mockup-segments" role="group" aria-label="Stage width">
              {[390, 1440].map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={!custom && stageWidth === size}
                  onClick={() => choose(size)}
                >
                  {size}
                </button>
              ))}
              <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>
                Custom
              </button>
            </div>
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
            <div className="tmt-block-mockup-segments" role="group" aria-label="Theme">
              {themes.map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={appearance === mode}
                  onClick={() => {
                    setAppearance(mode);
                    onSettingsChange?.({ width: stageWidth, theme: mode });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {unavailable ? (
            <p role="status">
              {typeof unavailable === 'string'
                ? unavailable
                : 'This design system version is not available.'}
            </p>
          ) : (
            <div
              className="tmt-block-mockup-viewport"
              ref={viewport}
              style={{ height: stageHeight * scale }}
            >
              <DsScope
                className="tmt-block-mockup-stage"
                style={{ width: stageWidth, height: stageHeight, transform: `scale(${scale})` }}
              >
                <div ref={content} data-theme={appearance === 'viewer' ? undefined : appearance}>
                  {children}
                </div>
              </DsScope>
            </div>
          )}
          {/* Only the number shows, so a page in any language mixes in no English; the words stay
              in the title and accessible name. */}
          {scale < 1 && (
            <span
              className="tmt-block-mockup-scale"
              title={`Scaled ${Math.round(scale * 100)}%`}
              aria-label={`Scaled ${Math.round(scale * 100)}%`}
            >
              {Math.round(scale * 100)}%
            </span>
          )}
        </section>
      </UiTheme>
    </div>
  );
}
