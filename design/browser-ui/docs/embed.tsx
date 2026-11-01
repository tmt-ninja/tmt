// The docs inside Design (#5866): the GUI and TUI design-system docs drawn in the host's document,
// not framed, since owner assets refuse framing. The host owns the URL, the header and the system
// switcher; the docs keep their nav, content and preview controls. Every docs style is scoped to
// the docs' element and leaves with it; the host already loads the browser-ui tokens and parts.
import docs from './docs.css?inline';
import mockColab from './mock-colab.css?inline';
import mockReader from './mock-reader.css?inline';
import mockList from './mock-list.css?inline';
import gallery from '../gallery/gallery.css?inline';
import editorial from '../generated/editorial.css?inline';
import { useLayoutEffect, useRef, useState } from 'react';
import { frameFor } from '../gallery/frames.js';
import { drawFramesInline } from '../gallery/kit.js';
import { DocsApp } from './app.js';
import { ColabMock } from './mock-colab.js';
import { PatternFrame } from './patterns-more.js';
import { previewRoot } from './preview.js';
import { hostDocs } from './router.js';
import { canonicalPath, colabMockBase, tuiMockBase } from './routes.js';
import { scopeCss } from './scope-css.js';
import { TuiMock } from './tui-nav.js';

const SCOPE = '.tmt-design-docs';
let styles: string | undefined;
const scoped = () =>
  (styles ??= [editorial, gallery, docs, mockColab, mockReader, mockList]
    .map((css) => scopeCss(css, SCOPE))
    .join('\n'));

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
    const style = document.createElement('style');
    style.dataset.tmtDesignDocs = '';
    style.textContent = scoped();
    document.head.append(style);
    previewRoot(root.current!);
    drawFramesInline((params) =>
      params.get('frame') === 'pattern' ? (
        <PatternFrame params={params} />
      ) : (
        frameFor(params.get('frame')!, params)
      ),
    );
    setReady(true);
    return () => {
      drawFramesInline(undefined);
      previewRoot(undefined);
      hostDocs(undefined);
      style.remove();
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
