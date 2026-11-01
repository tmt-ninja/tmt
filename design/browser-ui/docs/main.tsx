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
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DocsApp } from './app.js';
import { setPaletteBFavicon } from './favicon.js';
import { ColabMock } from './mock-colab.js';
import { TuiMock } from './tui-nav.js';
import { usePath } from './router.js';
import { frameFor } from '../gallery/frames.js';

function Root() {
  const path = usePath();
  useEffect(() => {
    if (path === '/' || path === '') history.replaceState(null, '', '/docs');
  }, [path]);
  if (path.startsWith('/mock/colab')) return <ColabMock path={path} />;
  if (path.startsWith('/mock/tui')) return <TuiMock path={path} />;
  return <DocsApp path={path === '/' ? '/docs' : path} />;
}

// A gallery frame (`?frame=`): the iframe demos of the Browser entries, in palette B and the theme
// the frame names, not the viewer's stored one.
const params = new URLSearchParams(location.search);
const frame = params.get('frame');
if (frame) {
  document.documentElement.dataset.frame = frame;
  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}
setPaletteBFavicon();
createRoot(document.querySelector('#root')!).render(
  <StrictMode>{frame ? frameFor(frame, params) : <Root />}</StrictMode>,
);
