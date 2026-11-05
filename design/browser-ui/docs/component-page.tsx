import { Suspense, type ComponentType } from 'react';
import { drawFramesInline } from '../gallery/kit.js';
import { browserDocs, browserExports, type BrowserDoc } from './browser-catalog.js';
import { components, type ComponentDoc } from './catalog.js';
import { useFramePreview } from './foundation-page.js';
import { UiTheme } from '../src/ui/index.js';
import { BlocksFrame } from '../gallery/blocks-frame.js';
import { DataTableFrame } from '../gallery/data-table-frame.js';
import { PageListFrame } from '../gallery/page-list-frame.js';
import { DialogFrame, DrawerFrame, PanelFrame, SourceFrame } from '../gallery/frames.js';
import { motionNotes, Replay } from './motion.js';
import { Article, ComponentTemplate, Snippet } from './templates.js';

/** A component's docs page: hero, usage, variants and states, props, then do and don't. */
export function ComponentPage({ doc }: { doc: ComponentDoc }) {
  return (
    <ComponentTemplate
      title={doc.name}
      lead={doc.description}
      preview={motionNotes[doc.slug] ? <Replay>{doc.preview()}</Replay> : doc.preview()}
      motion={motionNotes[doc.slug]}
      usage={doc.usage}
      variants={doc.variants.map(([label, render]) => ({ label, render: render() }))}
      dos={doc.dos}
    />
  );
}

/** A Browser component: the gallery's section for it, every demo in light and dark side by side. */
export function BrowserPage({ doc }: { doc: BrowserDoc }) {
  const names = browserExports(doc);
  return (
    <Article title={doc.name} lead={doc.description}>
      {names.length > 0 && (
        <>
          <h2>Usage</h2>
          <Snippet
            code={`import { ${names.join(', ')} } from '@tmt/browser-ui/${doc.entry ?? 'react'}';`}
          />
        </>
      )}
      <p className="docs-muted">
        Styles: {doc.css.map((name) => `src/${name}.css`).join(', ')}
        {doc.entry === 'pattern-parts'
          ? ', exposed as @tmt/browser-ui/pattern-parts.css.'
          : ', in the shared static.css.'}
      </p>
      <h2>Variants and states</h2>
      <div className="docs-browser-demo">
        <Suspense fallback={<p data-scene-loading="">Loading preview…</p>}>
          <doc.Demo />
        </Suspense>
      </div>
    </Article>
  );
}

// Only the scenes component pages frame; the docs' full registry (mocks, TUI) stays out of a frame.
const scenes: Record<string, ComponentType<{ params: URLSearchParams }>> = {
  blocks: BlocksFrame,
  'data-table': DataTableFrame,
  'page-list': PageListFrame,
  // The Browser overlays (#6090): drawn in their stage, as the docs' own frames show them.
  dialog: DialogFrame,
  drawer: DrawerFrame,
  panel: PanelFrame,
  source: SourceFrame,
};
/** A page frame cannot load the docs site's frame pages: the host that runs DocsComponentPage
 * calls this once, before rendering, so their scenes draw inline, as in Design's hosted docs. */
export function drawComponentScenesInline() {
  drawFramesInline(drawScene);
}
function drawScene(_path: string, params: URLSearchParams) {
  // As the docs draw a frame inline: closed overlays, scoped to the stage.
  const next = new URLSearchParams(params);
  next.set('open', 'false');
  next.set('scope', 'true');
  const Scene = scenes[next.get('frame') ?? ''];
  return Scene ? <Scene params={next} /> : <p role="alert">Unknown preview</p>;
}

/** A component's page as the docs show it, by its docs path (`components/button`,
 * `browser/avatar`): the same live scenes, drawn in the frame that hosts it (#6060). */
export function DocsComponentPage({ page }: { page: string }) {
  // The docs shell's theme: the frame's, which UI portals (menus, dialogs) originate from.
  const { theme } = useFramePreview();
  const [section, slug] = page.split('/');
  const component = section === 'components' && components.find((entry) => entry.slug === slug);
  const browser = section === 'browser' && browserDocs.find((entry) => entry.slug === slug);
  if (!component && !browser) return null;
  return (
    <UiTheme theme={theme}>
      {component ? <ComponentPage doc={component} /> : <BrowserPage doc={browser as BrowserDoc} />}
    </UiTheme>
  );
}
