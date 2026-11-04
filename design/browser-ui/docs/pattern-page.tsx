import { DsScope, UiTheme } from '../src/ui/index.js';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { morePatterns } from './patterns-more.js';
import { patterns } from './patterns.js';
import { useFramePreview } from './foundation-page.js';

// Every scene uses the shared component implementations from the design-system docs.
export const livePatternSlugs = [
  'tabs-row',
  'list-row',
  'empty-state',
  'status-line',
  'planned',
  'list-controls',
  'dense-table',
  'fab-window',
  'add-dialog',
  'needs-you',
  'work-band',
  'sending-rows',
  'loading-error',
  'confirm-notify',
  'blocks-document',
  'blocks-insert',
  'blocks-menu',
  'blocks-drag',
  'blocks-delete',
  'blocks-selection',
] as const;

/** Keep the stage's real width while fitting its preview into the page column. */
function PatternStage({
  width,
  height,
  theme,
  children,
}: {
  width: number;
  height: number;
  theme: 'light' | 'dark';
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const fit = () => setScale(Math.min(1, node.clientWidth / width));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);
  return (
    <figure className="pattern-viewport" data-width={width} data-theme={theme}>
      <figcaption>
        {width} · {theme}
      </figcaption>
      <div className="scaled-frame" ref={box} style={{ maxWidth: width, height: height * scale }}>
        <DsScope
          className="scaled-frame-inline"
          style={{ width, height, transform: `scale(${scale})` }}
        >
          <div data-theme={theme} data-tmt-palette="b">
            <UiTheme theme={theme}>
              <div className="pattern-frame">{children}</div>
            </UiTheme>
          </div>
        </DsScope>
      </div>
    </figure>
  );
}

/** The docs' own interactive pattern scenes, each isolated in its originating stage. */
export function PatternPage({ page }: { page: string }) {
  const { theme } = useFramePreview();
  if (!livePatternSlugs.some((slug) => slug === page)) return null;
  const simple = patterns.find((entry) => entry.slug === page);
  if (simple)
    return (
      <article className="docs-article">
        <h1>{simple.title}</h1>
        <p className="docs-lead">{simple.lead}</p>
        <DsScope style={{ width: '100%', height: '320px' }}>
          <UiTheme theme={theme}>{simple.render()}</UiTheme>
        </DsScope>
      </article>
    );
  const doc = morePatterns.find((entry) => entry.slug === page);
  if (!doc) return null;
  const Body = doc.Body;
  return (
    <article className="docs-article">
      <h1>{doc.title}</h1>
      <p className="docs-lead">{doc.lead}</p>
      <ul className="docs-list">
        {doc.rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      {doc.states.map(([state, label]) => (
        <section className="docs-variant" key={state}>
          <h3>{label}</h3>
          <div className="pattern-viewports">
            {(['light', 'dark'] as const).flatMap((stageTheme) =>
              [1440, 390].map((width) => (
                <PatternStage
                  key={`${stageTheme}-${width}`}
                  width={width}
                  height={doc.height}
                  theme={stageTheme}
                >
                  <Body state={state} />
                </PatternStage>
              )),
            )}
          </div>
        </section>
      ))}
    </article>
  );
}
