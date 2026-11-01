// Dev-only design-system docs and the Colab mockup (#5821), in palette B. See vite.docs.config.ts.
import '../generated/static.css';
import '../generated/ui.css';
import '../generated/editorial.css';
// The gallery's host metrics and demo layout: the Browser component entries reuse its sections.
import '../gallery/gallery.css';
import './docs.css';
import './mock-colab.css';
import './mock-reader.css';
import './mock-list.css';
// The TUI pages' styles load here, not in their modules, so a host loads them only scoped (#5866).
import './tui/tui.css';
import './mock-tui/mock-tui.css';
import { StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DocsApp } from './app.js';
import { setPaletteBFavicon } from './favicon.js';
import { ColabMock } from './mock-colab.js';
import { TuiMock } from './tui-nav.js';
import { currentLocation, replacePath, usePath } from './router.js';
import { previewRoot } from './preview.js';
import { frameFor } from '../gallery/frames.js';
import { PatternFrame } from './patterns-more.js';
import { canonicalPath, colabMockBase, tuiMockBase } from './routes.js';

// An old /docs or /mock URL, or the bare root, moves to its design system's route (#5821).
function redirect() {
  const { path, search } = currentLocation();
  const next = canonicalPath(path);
  if (next) replacePath(`${next}${search}${location.hash}`);
  return next;
}
redirect();

function Root() {
  const path = usePath();
  useLayoutEffect(() => {
    redirect();
  }, [path]);
  const current = canonicalPath(path) ?? path;
  if (current.startsWith(colabMockBase)) return <ColabMock path={current} />;
  // The TUI mock still matches its first URLs (docs/mock-tui, #5835) until it reads tuiMockBase.
  if (current.startsWith(tuiMockBase))
    return <TuiMock path={`/mock/tui${current.slice(tuiMockBase.length)}`} />;
  return <DocsApp path={current} />;
}

// A gallery frame (`?frame=`): the iframe demos of the Browser entries, in palette B and the theme
// the frame names, not the viewer's stored one.
previewRoot(document.documentElement);
const params = new URLSearchParams(location.search);
const frame = params.get('frame');
if (frame) {
  document.documentElement.dataset.frame = frame;
  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}
setPaletteBFavicon();
createRoot(document.querySelector('#root')!).render(
  <StrictMode>
    {frame === 'pattern' ? (
      <PatternFrame params={params} />
    ) : frame ? (
      frameFor(frame, params)
    ) : (
      <Root />
    )}
  </StrictMode>,
);
