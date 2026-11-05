/** The docs reference a Design scene test compares against: the docs' own component page, drawn in
 * this document as Design's hosted docs draw it (@tmt/browser-ui/docs-embed). */
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { DesignDocs } from '@tmt/browser-ui/docs-embed';
import '@tmt/browser-ui/static.css';
import '../src/style.css';

let root: Root | undefined;
/** Show the docs page at `path`; the docs route follows it after the render commits. */
export function mountDocs(path: string) {
  let host = document.getElementById('docs-reference');
  const docs = <DesignDocs base="/r" path={`/r${path}`} navigate={() => {}} />;
  if (!host) {
    host = document.createElement('div');
    host.id = 'docs-reference';
    document.body.prepend(host);
    root = createRoot(host);
  }
  host.hidden = false;
  flushSync(() => root!.render(docs));
}
/** Keep the docs mounted but out of the layout while the Design page is measured. */
export function hideDocs() {
  const host = document.getElementById('docs-reference');
  if (host) host.hidden = true;
}
