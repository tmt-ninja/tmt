import { createRoot } from 'react-dom/client';
import { ColabHeader } from '../src/colab-header.js';

export function mountHeaderSuffix() {
  const host = document.createElement('div');
  host.id = 'header-suffix-fixture';
  document.body.replaceChildren(host);
  createRoot(host).render(
    <ColabHeader
      title="Release plan"
      brandOnly
      headingSuffix={<span>· A very long project suffix for the November release</span>}
    />,
  );
}
