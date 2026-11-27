import { CodeTextBlock } from '@tmt/browser-ui/blocks';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { admitDiagram } from './diagram-source.js';
import type { DiagramTheme, Drawn } from './diagram-draw.js';
import { text as strings } from './strings.js';
import { getTheme, subscribeTheme } from './theme.js';
import { useMedia } from './use-media.js';

/** Mermaid's colours, each from the design system's role for it in the theme shown now. */
const ROLES: Readonly<Record<string, string>> = {
  background: '--tmt-ui-surface-paper',
  primaryColor: '--tmt-ui-surface-code',
  mainBkg: '--tmt-ui-surface-code',
  secondaryColor: '--tmt-ui-surface-sheet',
  tertiaryColor: '--tmt-ui-surface-sheet',
  primaryTextColor: '--tmt-ui-color-text',
  secondaryTextColor: '--tmt-ui-color-text',
  tertiaryTextColor: '--tmt-ui-color-text',
  textColor: '--tmt-ui-color-text',
  nodeTextColor: '--tmt-ui-color-text',
  titleColor: '--tmt-ui-color-text',
  primaryBorderColor: '--tmt-ui-color-edge',
  nodeBorder: '--tmt-ui-color-edge',
  lineColor: '--tmt-ui-color-secondary',
  clusterBkg: '--tmt-ui-surface-sheet',
  clusterBorder: '--tmt-ui-surface-rule',
  edgeLabelBackground: '--tmt-ui-surface-paper',
  labelBackgroundColor: '--tmt-ui-surface-paper',
  // A sequence's notes, otherwise Mermaid's yellow.
  noteBkgColor: '--tmt-ui-surface-sheet',
  noteTextColor: '--tmt-ui-color-text',
  noteBorderColor: '--tmt-ui-color-edge',
};

/** The theme a diagram is drawn in: each role resolved to the colour it shows now. */
function diagramTheme(host: Element, dark: boolean): DiagramTheme {
  const probe = host.ownerDocument.createElement('span');
  probe.hidden = true;
  host.append(probe);
  const variables: Record<string, string> = {};
  for (const [name, role] of Object.entries(ROLES)) {
    probe.style.color = `var(${role})`;
    variables[name] = getComputedStyle(probe).color;
  }
  probe.style.fontFamily = 'var(--tmt-ui-font-body)';
  const fontFamily = getComputedStyle(probe).fontFamily;
  probe.remove();
  return { dark, variables, fontFamily };
}

let drawer: Promise<typeof import('./diagram-draw.js')> | undefined;

export interface DiagramBlockProps {
  /** The block's ID: the drawn SVG's own, so two diagrams never share their styles. */
  id: string;
  title?: string;
  /** The block's text: its Mermaid source. */
  source: string;
  /** The source is open in the editor (`children`): the drawing of what the page holds sits under it. */
  editing?: boolean;
  children?: ReactNode;
}

type View = { key: string; drawn?: Drawn; failed?: true };

/**
 * A diagram block (#6746): its source drawn as a flowchart, sequence, state, Gantt or class diagram
 * in the page's theme, with the source a disclosure away. A source the page does not draw, or one Mermaid cannot read, is never a blank:
 * the block says why and which line, and shows the source as it is.
 */
export function DiagramBlock({
  id,
  title,
  source,
  editing,
  children,
}: DiagramBlockProps): ReactNode {
  const dark = useSyncExternalStore(subscribeTheme, getTheme) === 'dark';
  const admitted = admitDiagram(source);
  const key = `${dark}\n${source}`;
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<View>({ key: '' });
  useEffect(() => {
    if (!admitted.ok || !host) return;
    let live = true;
    drawer ??= import('./diagram-draw.js');
    void drawer
      .then(({ drawDiagram }) =>
        drawDiagram(`diagram-${id}`, admitted.source, diagramTheme(host, dark)),
      )
      .then(
        (drawn) => live && setView({ key, drawn }),
        () => {
          // A drawer that did not load is asked again next time.
          drawer = undefined;
          if (live) setView({ key, failed: true });
        },
      );
    return () => {
      live = false;
    };
    // `admitted` follows `source`; `key` holds both inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, host, id]);
  const shown = view.key === key ? view : undefined;
  const drawn = shown?.drawn && 'svg' in shown.drawn ? shown.drawn.svg : undefined;
  const error = shown?.drawn && 'error' in shown.drawn ? shown.drawn.error : undefined;
  const why = !admitted.ok
    ? admitted.reason === 'lines'
      ? strings.diagram.lines(admitted.limit)
      : strings.diagram[admitted.reason]
    : shown?.failed
      ? strings.diagram.unavailable
      : undefined;
  return (
    <figure
      ref={setHost}
      className="structured-diagram"
      data-state={drawn ? 'drawn' : error || why ? 'refused' : 'drawing'}
      data-kind={admitted.ok ? admitted.kind : undefined}
    >
      {title && <figcaption className="structured-diagram-title">{title}</figcaption>}
      {editing && <CodeTextBlock editing>{children}</CodeTextBlock>}
      {drawn ? (
        <>
          <DiagramDrawing
            svg={drawn}
            label={title ?? strings.diagram.label}
            // Only a flowchart can turn top-down; the other kinds have one layout.
            hint={editing && admitted.ok && admitted.kind === 'flowchart'}
          />
          {!editing && (
            <details className="structured-diagram-details">
              {/* Opening the source reads it; a click elsewhere on the block edits it. */}
              <summary onClick={(event) => event.stopPropagation()}>
                {strings.diagram.showSource}
              </summary>
              <DiagramSourceLines source={source} />
            </details>
          )}
        </>
      ) : error || why ? (
        <>
          <div className="structured-diagram-problem" role={error ? 'alert' : 'status'}>
            <strong>{error ? strings.diagram.unreadable(error.line) : why}</strong>
            {error && <pre className="structured-diagram-message">{error.excerpt}</pre>}
            {error?.detail && (
              // Mermaid's own list of what it expected: there for whoever wants it.
              <details className="structured-diagram-details">
                <summary onClick={(event) => event.stopPropagation()}>
                  {strings.diagram.details}
                </summary>
                <pre className="structured-diagram-message">{error.detail}</pre>
              </details>
            )}
            {error && <span>{strings.diagram.fix}</span>}
          </div>
          {source && !editing && <DiagramSourceLines source={source} />}
        </>
      ) : (
        <p className="structured-diagram-drawing" data-pending="">
          {strings.diagram.drawing}
        </p>
      )}
    </figure>
  );
}

/** A drawing shrinks to its column only while its text stays at least 11px (Mermaid draws 16px);
 * narrower than that it keeps its size and scrolls. */
const FIT_SCALE = 11 / 16;

/**
 * The drawn SVG, shrunk to its column when that keeps its text readable, else at its own size. A
 * diagram that scrolls sideways is a tab stop whose name says it scrolls.
 */
function DiagramDrawing({ svg, label, hint }: { svg: string; label: string; hint?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  // On a phone every diagram but the smallest scrolls; on a wider screen a flowchart that still
  // scrolls is told, while its source is open, how it would fit.
  const phone = useMedia('(max-width: 760px)');
  useEffect(() => {
    const node = box.current;
    const drawing = node?.querySelector('svg');
    if (!node || !drawing) return;
    const natural = drawing.viewBox.baseVal?.width || drawing.getBBox().width;
    const measure = () => {
      const fits = natural * FIT_SCALE <= node.clientWidth;
      drawing.style.width = fits ? '100%' : `${natural}px`;
      drawing.style.maxWidth = `${natural}px`;
      setWide(!fits);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [svg]);
  return (
    <>
      <div
        ref={box}
        className="structured-diagram-drawing"
        role="img"
        aria-label={wide ? strings.diagram.scrolls(label) : label}
        tabIndex={wide ? 0 : undefined}
        // Mermaid's SVG, drawn in strict mode and cleaned again (diagram-draw.ts).
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {hint && wide && !phone && <p className="structured-diagram-hint">{strings.diagram.wide}</p>}
    </>
  );
}

/** The source as typed, each line numbered as an editor numbers it. */
function DiagramSourceLines({ source }: { source: string }) {
  return (
    <pre className="structured-diagram-source">
      {source.split('\n').map((line, at) => (
        <span key={at} className="structured-diagram-line">
          <span className="structured-diagram-number" aria-hidden="true">
            {at + 1}
          </span>
          {line}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}
