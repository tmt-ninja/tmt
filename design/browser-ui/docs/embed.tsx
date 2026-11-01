// The docs inside Design (#5866): the GUI and TUI design-system docs drawn in the host's document,
// not framed, since owner assets refuse framing. The host owns the URL, the header and the system
// switcher; the docs keep their nav, content and preview controls. Every docs style sits in
// @scope (.tmt-design-docs) in one generated stylesheet, a self-hosted asset of the host's build
// (the owner policy admits no inline style); the host already loads the browser-ui tokens and parts.
import '../generated/docs-embed.css';
import { useLayoutEffect, useRef, useState } from 'react';
import { frameFor } from '../gallery/frames.js';
import { drawFramesInline } from '../gallery/kit.js';
import { DocsApp } from './app.js';
import { ColabMock } from './mock-colab.js';
import { PatternFrame } from './patterns-more.js';
import { previewRoot } from './preview.js';
import { hostDocs } from './router.js';
import { canonicalPath, colabMockBase, tuiMockBase } from './routes.js';
import { TuiMock } from './tui-nav.js';
import { TuiFrame } from './tui/frame.js';
import { oracle } from './tui/model.js';

export interface DesignDocsProps {
  /** The host path that holds the docs, such as `/colab/design`. */
  base: string;
  /** The host's current path and query, under `base`. */
  path: string;
  navigate(href: string): void;
}

/** The GUI and TUI docs, for a host that brings its own header and system switcher. */
export function DesignDocs({ base, path, navigate }: DesignDocsProps) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const trimmed = base.replace(/\/+$/, '');
  const inner = (path.startsWith(trimmed) ? path.slice(trimmed.length) : '').split('?')[0] || '/';
  useLayoutEffect(() => {
    hostDocs({ base: trimmed, path, navigate });
  }, [trimmed, path, navigate]);
  useLayoutEffect(() => {
    previewRoot(root.current!);
    drawFramesInline((path, params) =>
      path.endsWith('/tui/frame.html') ? (
        <TuiFramePreview params={params} />
      ) : params.get('frame') === 'pattern' ? (
        <PatternFrame params={params} />
      ) : (
        frameFor(params.get('frame') ?? '', params)
      ),
    );
    setReady(true);
    return () => {
      drawFramesInline(undefined);
      previewRoot(undefined);
      hostDocs(undefined);
    };
  }, []);
  // An old or bare docs path moves to its system's route, as on the docs site.
  const next = canonicalPath(inner);
  useLayoutEffect(() => {
    if (next) navigate(`${trimmed}${next}`);
  }, [next, trimmed, navigate]);
  const current = next ?? inner;
  return (
    <div ref={root} className="tmt-design-docs" data-chrome="hosted">
      {ready &&
        (current.startsWith(colabMockBase) ? (
          <ColabMock path={current} />
        ) : current.startsWith(tuiMockBase) ? (
          <TuiMock path={`/mock/tui${current.slice(tuiMockBase.length)}`} />
        ) : (
          <DocsApp path={current} />
        ))}
    </div>
  );
}

/** A TUI oracle frame (docs/tui/frame.html) drawn in the document, cropped as its query says. */
function TuiFramePreview({ params }: { params: URLSearchParams }) {
  const source = oracle.frames.find(
    (frame) =>
      frame.state === params.get('state') &&
      frame.look === params.get('look') &&
      frame.width === Number(params.get('columns')) &&
      frame.height === Number(params.get('rows')),
  );
  const from = Number(params.get('from') ?? 0);
  const to = Number(params.get('to') ?? source?.height);
  if (!source || !(from >= 0 && from < to && to <= source.height))
    return <p role="alert">No recorded oracle frame for this preview.</p>;
  const defaults = oracle.defaults[source.look === 'tmt-light' ? 'light' : 'dark'];
  return (
    <div style={{ backgroundColor: defaults.bg }}>
      <TuiFrame frame={source} crop={[from, to]} label={source.state} />
    </div>
  );
}
