import { frameFor } from '../gallery/frames.js';
import { PatternFrame } from './patterns-more.js';
import { TuiFramePreview } from './tui/frame-scene.js';

/** Render a documented scene in the current document and its owning scope. */
export function renderDocsPreview(path: string, params: URLSearchParams) {
  if (path.endsWith('/tui/frame.html')) return <TuiFramePreview params={params} />;
  if (params.get('frame') === 'pattern') return <PatternFrame params={params} />;
  const scoped = new URLSearchParams(params);
  scoped.set('open', 'false');
  scoped.set('scope', 'true');
  if (scoped.get('frame') === 'ui-overlay') scoped.set('state', 'closed');
  return frameFor(scoped.get('frame') ?? '', scoped);
}
