/** The page's own status notice (a NoticeCard in the canvas) next to a callout block's notice, under
 * the app's or the reader's stylesheet (#6280): only the page's notice is placed over the canvas. */
import '@tmt/browser-ui/static.css';
import { createRoot } from 'react-dom/client';
import { BrowserNotice } from '@tmt/browser-ui/react';
import { NoticeCard } from '../src/notice-card.js';

export async function mountCanvasNotice(sheet: 'app' | 'reader') {
  if (sheet === 'app') await import('../src/style.css');
  else await import('../src/reader-style.css');
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(host).render(
    <main className="canvas" style={{ position: 'relative', minHeight: 600 }}>
      <NoticeCard state="blocked" eyebrow="Colab" title="This page could not be drawn." />
      <div className="tmt-block-callout" data-testid="callout">
        <BrowserNotice
          tone="working"
          announcement="status"
          stateLabel="Working"
          mark={null}
          title="A callout"
          body={null}
        />
      </div>
    </main>,
  );
}
