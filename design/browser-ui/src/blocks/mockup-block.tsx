import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogClose, DialogContent, DialogTitle, DsScope, UiTheme } from '../ui/index.js';
import { BrowserNotice } from '../notice.js';
import { browserUiClasses as c } from '../static.js';

export interface MockupBlockProps {
  system?: string;
  version?: string;
  width?: number;
  /** The least stage height; the stage otherwise hugs its content. */
  height?: number;
  theme?: 'light' | 'dark' | 'viewer';
  /** No stage: true, or the reason shown instead (a page pin that does not match), as text or as
   * a heading that names what differs plus the message that says what the viewer can do. */
  unavailable?: boolean | string | MockupUnavailable;
  systems?: readonly { id: string; name: string; versions: readonly string[] }[];
  onSystemChange?(system: string): void;
  onVersionChange?(version: string): void;
  onSettingsChange?(settings: { width: number; theme: 'light' | 'dark' | 'viewer' }): void;
  /** The toolbar's segment words in the page's language; any one left out stays English. */
  labels?: MockupLabels;
  /**
   * `open` (the default) shows the toolbar. `collapsed` folds it behind one Mockup settings
   * control, for a stage that is read more than set, and offers a full-size view whenever the
   * stage is scaled down past easy reading.
   */
  toolbar?: 'open' | 'collapsed';
  /** What the full-size view draws, the children when absent. A host whose content draws only once
   * (a frame mounted on its node) passes a second instance. */
  fullSize?: ReactNode;
  children?: ReactNode;
}

export interface MockupUnavailable {
  heading: string;
  message: string;
}

export interface MockupLabels {
  custom?: string;
  light?: string;
  dark?: string;
  viewer?: string;
  settings?: string;
  fullSize?: string;
  closeFullSize?: string;
}

/**
 * The stage height: its content's, at least `min`. A stage with no minimum hugs everything,
 * a phone sheet included: the sheet drops its 60cqh bound there (blocks.css), so the stage
 * leaves no empty tail. A stage with a minimum is a device: its sheet keeps the 60% bound,
 * which follows the stage, so the stage holds the minimum rather than chase its own sheet.
 */
function mockupStageHeight(min: number, content: HTMLElement) {
  const sheet = content.querySelector('.tmt-block-menu[data-placement="sheet"]');
  const height = sheet && min ? min : Math.max(min, content.offsetHeight);
  return Math.min(4096, height);
}

const boundedWidth = (width: number) =>
  Number.isFinite(width) ? Math.max(1, Math.min(4096, Math.round(width))) : 390;

const themes = ['light', 'dark', 'viewer'] as const;
const english = {
  custom: 'Custom',
  light: 'Light',
  dark: 'Dark',
  viewer: 'Viewer',
  settings: 'Mockup settings',
  fullSize: 'Open at full size',
  closeFullSize: 'Close full-size view',
};

/** A stage scaled below this draws its 14px body text under 11px, too small to read with ease: a
 * collapsed toolbar then offers the full-size view. */
export const MOCKUP_READABLE_SCALE = 11 / 14;

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
  labels,
  toolbar = 'open',
  fullSize,
  children,
}: MockupBlockProps) {
  const words = { ...english, ...labels };
  const collapsed = toolbar === 'collapsed';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [full, setFull] = useState(false);
  const toolbarId = useId();
  const close = useRef<HTMLButtonElement>(null);
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
  const offerFull = collapsed && !unavailable && scale < MOCKUP_READABLE_SCALE;
  const choose = (next: number) => {
    setCustom(false);
    setStageWidth(next);
    onSettingsChange?.({ width: next, theme: appearance });
  };
  return (
    <div className="tmt-block-mockup-host">
      <UiTheme>
        <section className="tmt-block-mockup" aria-label={`${system} mockup`}>
          {collapsed && (
            <div className="tmt-block-mockup-bar">
              <button
                type="button"
                className="tmt-block-mockup-disclosure"
                aria-expanded={settingsOpen}
                aria-controls={toolbarId}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                {words.settings}
              </button>
              {offerFull && (
                <button
                  type="button"
                  className="tmt-block-mockup-open"
                  onClick={() => setFull(true)}
                >
                  {words.fullSize}
                  <span aria-hidden="true"> ↗</span>
                </button>
              )}
            </div>
          )}
          <div
            id={toolbarId}
            className="tmt-block-mockup-toolbar"
            role="toolbar"
            aria-label={words.settings}
            hidden={collapsed && !settingsOpen}
          >
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
              // The release reads on screen; the full pin, hash included, is its title and name.
              <span
                className="tmt-block-mockup-pin"
                title={`${system}@${version}`}
                aria-label={`${system}@${version}`}
              >
                {system}@{version.split('#')[0]}
              </span>
            )}
            <div className="tmt-block-segments" role="group" aria-label="Stage width">
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
                {words.custom}
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
            <div className="tmt-block-segments" role="group" aria-label="Theme">
              {themes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={appearance === mode}
                  onClick={() => {
                    setAppearance(mode);
                    onSettingsChange?.({ width: stageWidth, theme: mode });
                  }}
                >
                  {words[mode]}
                </button>
              ))}
            </div>
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
          </div>
          {unavailable ? (
            // The notice takes the stage's place, in the shared tinted notice (#5981).
            <div className="tmt-block-mockup-notice">
              <BrowserNotice
                tone="waiting"
                variant="tinted"
                announcement="status"
                mark="◆"
                stateLabel="Stage not drawn"
                title={typeof unavailable === 'object' ? unavailable.heading : undefined}
                headingLevel="h3"
                body={
                  typeof unavailable === 'object'
                    ? unavailable.message
                    : typeof unavailable === 'string'
                      ? unavailable
                      : 'This design system version is not available.'
                }
              />
            </div>
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
                <div
                  ref={content}
                  data-theme={appearance === 'viewer' ? undefined : appearance}
                  data-hug={min ? undefined : ''}
                >
                  {children}
                </div>
              </DsScope>
            </div>
          )}
          {collapsed && !unavailable && (offerFull || full) && (
            // The stage at its own width, scrolling where the window is narrower. It stays open
            // while shown, even if a wider window no longer scales the stage down.
            <Dialog open={full} onOpenChange={setFull}>
              <DialogContent
                className="tmt-block-mockup-full"
                showCloseButton={false}
                // Its title is for assistive technology only: focus starts on the one visible
                // control.
                initialFocus={() => close.current}
              >
                <div className="tmt-block-mockup-full-bar">
                  <DialogClose asChild>
                    <button ref={close} type="button" className="tmt-block-mockup-full-close">
                      {words.closeFullSize}
                    </button>
                  </DialogClose>
                  <DialogTitle className={c.visuallyHidden}>
                    {`${system} mockup at full size`}
                  </DialogTitle>
                </div>
                <div className="tmt-block-mockup-full-viewport">
                  <MockupFullStage width={stageWidth} min={min} appearance={appearance}>
                    {fullSize ?? children}
                  </MockupFullStage>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </section>
      </UiTheme>
    </div>
  );
}

/** The full-size view's stage: the block's width, unscaled, as tall as what it draws (a stage is a
 * size container, so its height is given rather than taken from its content). */
function MockupFullStage({
  width,
  min,
  appearance,
  children,
}: {
  width: number;
  min: number;
  appearance: 'light' | 'dark' | 'viewer';
  children?: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(min);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const update = () => setHeight(mockupStageHeight(min, node));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [min, width]);
  return (
    <DsScope className="tmt-block-mockup-stage" style={{ width, height }}>
      <div
        ref={content}
        data-theme={appearance === 'viewer' ? undefined : appearance}
        data-hug={min ? undefined : ''}
      >
        {children}
      </div>
    </DsScope>
  );
}
