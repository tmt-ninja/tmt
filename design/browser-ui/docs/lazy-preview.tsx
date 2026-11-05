import { lazy, Suspense, type ComponentType } from 'react';
import { PatternFrame } from './patterns-more.js';

type Scene = ComponentType<{ params: URLSearchParams }>;
const scene = (load: () => Promise<{ default: Scene }>) => lazy(load);
// Each scene is loaded only when its preview mounts; no gallery registry is in the docs entry.
const scenes: Record<string, ReturnType<typeof scene>> = {
  'page-list': scene(() =>
    import('../gallery/page-list-frame.js').then((m) => ({ default: m.PageListFrame })),
  ),
  'data-table': scene(() =>
    import('../gallery/data-table-frame.js').then((m) => ({ default: m.DataTableFrame })),
  ),
  blocks: scene(() =>
    import('../gallery/blocks-frame.js').then((m) => ({ default: m.BlocksFrame })),
  ),
  'rich-input': scene(() =>
    import('../gallery/rich-input-frame.js').then((m) => ({ default: m.RichInputFrame })),
  ),
  'tabs-bar': scene(() =>
    import('../gallery/tabs-bar-frame.js').then((m) => ({ default: m.TabsBarFrame })),
  ),
  'compact-controls': scene(() =>
    import('../gallery/compact-controls-frame.js').then((m) => ({
      default: m.CompactControlsFrame,
    })),
  ),
  'menu-host': scene(() =>
    import('../gallery/menu-host-frame.js').then((m) => ({ default: m.MenuHostFrame })),
  ),
  rail: scene(() => import('../gallery/rail-frame.js').then((m) => ({ default: m.RailFrame }))),
  topbar: scene(() =>
    import('../gallery/topbar-frame.js').then((m) => ({ default: m.TopBarFrame })),
  ),
  'theme-b': scene(() => import('../gallery/theme-b.js').then((m) => ({ default: m.ThemeBFrame }))),
  floating: scene(() =>
    import('../gallery/floating-frame.js').then((m) => ({ default: m.FloatingFrame })),
  ),
  'ui-overlay': scene(() =>
    import('../gallery/ui-overlays.js').then((m) => ({ default: m.UiOverlayFrame })),
  ),
  'ui-contrast': scene(() =>
    import('../gallery/ui-contrast-frame.js').then((m) => ({ default: m.UiContrastFrame })),
  ),
  tui: scene(() => import('./tui/frame-scene.js').then((m) => ({ default: m.TuiFramePreview }))),
  shell: scene(() => import('../gallery/frames.js').then((m) => ({ default: m.ShellFrame }))),
  hosted: scene(() => import('../gallery/frames.js').then((m) => ({ default: m.HostedFrame }))),
  dialog: scene(() => import('../gallery/frames.js').then((m) => ({ default: m.DialogFrame }))),
  panel: scene(() => import('../gallery/frames.js').then((m) => ({ default: m.PanelFrame }))),
  drawer: scene(() => import('../gallery/frames.js').then((m) => ({ default: m.DrawerFrame }))),
  source: scene(() => import('../gallery/frames.js').then((m) => ({ default: m.SourceFrame }))),
  glyphs: scene(() => import('../gallery/frames.js').then((m) => ({ default: m.GlyphFrame }))),
  menu: scene(() =>
    import('../gallery/frames.js').then((m) => ({
      default: ({ params }) => <m.MenuFrame scoped={params.get('scope') === 'true'} />,
    })),
  ),
  notifications: scene(() =>
    import('../gallery/frames.js').then((m) => ({
      default: ({ params }) => <m.NotificationsFrame scoped={params.get('scope') === 'true'} />,
    })),
  ),
  notice: scene(() =>
    import('../gallery/components.js').then((m) => ({
      default: () => (
        <main className="gallery-main">
          <m.NoticeSection />
        </main>
      ),
    })),
  ),
  charts: scene(() => import('../gallery/charts.js').then((m) => ({ default: m.ChartsSection }))),
  prose: scene(() =>
    import('../gallery/editorial.js').then((m) => ({
      default: () => (
        <main className="gallery-main">
          <m.EditorialSection />
        </main>
      ),
    })),
  ),
};

/** Render one requested scene in its existing scope without a document-wide frame. */
export function renderDocsPreview(path: string, params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.set('open', 'false');
  next.set('scope', 'true');
  if (next.get('frame') === 'ui-overlay') next.set('state', 'closed');
  const name = path.endsWith('/tui/frame.html') ? 'tui' : (next.get('frame') ?? '');
  // Pattern definitions are already in the docs shell; do not suspend each of its 16 scenes.
  if (name === 'pattern') return <PatternFrame params={next} />;
  const Preview = scenes[name];
  return Preview ? (
    <Suspense fallback={<p data-scene-loading="">Loading preview…</p>}>
      <Preview params={next} />
    </Suspense>
  ) : (
    <p role="alert">Unknown preview {name}</p>
  );
}
