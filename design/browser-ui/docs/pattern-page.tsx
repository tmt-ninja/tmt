import { DsScope, UiTheme } from '../src/ui/index.js';
import { morePatterns } from './patterns-more.js';
import { patterns } from './patterns.js';
import { useFramePreview } from './foundation-page.js';
import { layoutPatterns, PatternStage } from './patterns-layout.js';

// Every scene uses the shared component implementations from the design-system docs.
export const livePatternSlugs = [
  'tabs-row',
  'list-row',
  'empty-state',
  'status-line',
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
  'shell',
  'page-layouts',
  'responsive',
] as const;

/** The docs' own interactive pattern scenes, each isolated in its originating stage. */
export function PatternPage({ page }: { page: string }) {
  const { theme } = useFramePreview();
  if (!livePatternSlugs.some((slug) => slug === page)) return null;
  const layout = layoutPatterns.find((entry) => entry.slug === page);
  if (layout)
    return (
      <article className="docs-article">
        <h1>{layout.title}</h1>
        <p className="docs-lead">{layout.lead}</p>
        {layout.render()}
      </article>
    );
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
