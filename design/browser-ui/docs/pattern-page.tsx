import { DsScope, UiTheme } from '../src/ui/index.js';
import { morePatterns } from './patterns-more.js';
import { useFramePreview } from './foundation-page.js';

// These scenes use shared parts. The remaining scenes still contain stand-ins and are converted
// separately before they are exposed here.
export const livePatternSlugs = [
  'tabs-row',
  'dense-table',
  'fab-window',
  'add-dialog',
  'needs-you',
  'loading-error',
  'confirm-notify',
  'blocks-document',
  'blocks-insert',
  'blocks-menu',
] as const;

/** The docs' own interactive pattern scenes, each isolated in its originating stage. */
export function PatternPage({ page }: { page: string }) {
  const { theme } = useFramePreview();
  if (!livePatternSlugs.some((slug) => slug === page)) return null;
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
          <DsScope style={{ width: '100%', height: `${doc.height}px` }}>
            <UiTheme theme={theme}>
              <div className="pattern-frame">
                <Body state={state} />
              </div>
            </UiTheme>
          </DsScope>
        </section>
      ))}
    </article>
  );
}
