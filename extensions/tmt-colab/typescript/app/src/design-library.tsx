import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrowserAction } from '@tmt/browser-ui/react';
import type { PageTransport } from './transport.js';
import {
  listDesignSystems,
  publishNext,
  type DesignSystemEntry,
  type DesignTreeNode,
} from './design-system-pages.js';
import { DesignSystemDialog } from './design-system-ui.js';
import { DesignHeader } from './design-header.js';
import { DesignPage } from './design-page.js';
const DesignDocs = lazy(() =>
  import('../../../../../design/browser-ui/docs/embed.js').then((module) => ({
    default: module.DesignDocs,
  })),
);
import { designBase } from './entry.js';
import { browserUiClasses } from '@tmt/browser-ui/static';
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
function findPage(node: DesignTreeNode, id: string): DesignTreeNode | undefined {
  return encodeURIComponent(node.id) === id
    ? node
    : node.children.map((child) => findPage(child, id)).find(Boolean);
}
function Tree({
  node,
  current,
  rootId,
  base,
  navigate,
}: {
  node: DesignTreeNode;
  current: string;
  rootId: string;
  base: string;
  navigate(href: string): void;
}) {
  const href = `${base}/systems/${encodeURIComponent(rootId)}/${encodeURIComponent(node.id)}`;
  return (
    <li>
      <a
        href={href}
        aria-current={node.id === current ? 'page' : undefined}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          navigate(href);
        }}
      >
        {node.title}
      </a>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Tree
              key={child.id}
              node={child}
              current={current}
              rootId={rootId}
              base={base}
              navigate={navigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
/** The Design header owns system operations; Colab pages are only the storage underneath. */
export function DesignLibrary({
  transport,
  path,
  navigate,
}: {
  transport: PageTransport;
  path: string;
  navigate(href: string): void;
}) {
  const base = designBase();
  const [systems, setSystems] = useState<DesignSystemEntry[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const section = workspace.current;
    const bar = section?.closest('.tmt-ui-shell')?.querySelector('.tmt-ui-shell-bar');
    if (!section || !bar) return;
    // The phone header wraps its actions. The content owns scrolling below its actual height.
    const resize = () =>
      section.style.setProperty(
        '--design-header-height',
        `${bar.getBoundingClientRect().height}px`,
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const read = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      const entries = await listDesignSystems(transport, controller.signal);
      if (controller.signal.aborted) return false;
      setSystems(entries);
      return true;
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorText(failure));
      return false;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [transport]);
  useEffect(() => {
    void refresh();
    return () => read.current?.abort();
  }, [refresh]);
  const selected = systems?.find(
    (entry) =>
      path === `${base}/systems/${encodeURIComponent(entry.id)}` ||
      path.startsWith(`${base}/systems/${encodeURIComponent(entry.id)}/`),
  );
  const userPath = path.startsWith(`${base}/systems/`);
  const pagePart = selected
    ? path.slice(`${base}/systems/${encodeURIComponent(selected.id)}`.length).replace(/^\//, '')
    : '';
  const page = selected
    ? pagePart
      ? findPage(selected.tree, pagePart)
      : selected.tree
    : undefined;
  const builtin = path.startsWith(`${base}/ds/tui`) ? 'tui' : 'gui';
  const current = selected ? `user:${selected.id}` : userPath ? 'unknown' : builtin;
  const publish = async () => {
    if (!selected || !transport.management) return;
    setPublishing(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await publishNext(transport, selected.id);
      setNotice(`Published ${result.version}.`);
      await refresh();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPublishing(false);
    }
  };
  const go = (href: string) => {
    setNavOpen(false);
    navigate(href);
  };
  return (
    <>
      <DesignHeader
        system={current}
        systems={[
          { id: 'gui', name: 'tmt GUI' },
          { id: 'tui', name: 'tmt TUI' },
          ...(userPath && !selected
            ? [
                {
                  id: 'unknown',
                  name: loading ? 'Loading design system…' : 'Unknown design system',
                },
              ]
            : []),
          ...(systems ?? []).map((entry) => ({ id: `user:${entry.id}`, name: entry.name })),
        ]}
        onSelect={(id) =>
          go(
            id.startsWith('user:')
              ? `${base}/systems/${encodeURIComponent(id.slice(5))}`
              : `${base}/ds/${id}`,
          )
        }
        actions={
          <>
            {page && (
              <a
                className={browserUiClasses.action}
                data-variant="text"
                href={new URL(`/colab/pages/${encodeURIComponent(page.id)}`, location.href).href}
              >
                Open in Colab
              </a>
            )}
            {transport.management ? (
              <>
                <BrowserAction
                  type="button"
                  variant="secondary"
                  label="New design system"
                  disabled={publishing || loading}
                  onActivate={() => {
                    setNotice(undefined);
                    setCreating(true);
                  }}
                />
                {selected && (
                  <BrowserAction
                    type="button"
                    variant="primary"
                    label={`Publish ${selected.next}`}
                    disabled={loading || error !== undefined}
                    busy={publishing}
                    onActivate={() => void publish()}
                  />
                )}
              </>
            ) : undefined}
          </>
        }
      />
      <section ref={workspace} className="design-workspace" aria-label="Design system library">
        {error && (
          <p className="design-feedback" role="alert">
            {error}{' '}
            <BrowserAction
              type="button"
              variant="text"
              label="Reload design systems"
              onActivate={() => void refresh()}
            />
          </p>
        )}
        {notice && (
          <p className="design-feedback" role="status">
            {notice}
          </p>
        )}
        {userPath ? (
          <>
            {loading && <p role="status">Loading design systems…</p>}
            {!loading && !error && !selected && (
              <p role="alert">This design system is not in the space’s Design trees.</p>
            )}
            {selected && (
              <div className="design-user-system">
                <button
                  type="button"
                  className="design-nav-toggle"
                  aria-expanded={navOpen}
                  onClick={() => setNavOpen(!navOpen)}
                >
                  Pages
                </button>
                <nav
                  className="design-page-tree"
                  data-open={navOpen || undefined}
                  aria-label={`${selected.name} pages`}
                >
                  <ul>
                    <Tree
                      node={selected.tree}
                      current={page?.id ?? ''}
                      rootId={selected.id}
                      base={base}
                      navigate={go}
                    />
                  </ul>
                </nav>
                {page ? (
                  <DesignPage
                    key={page.id}
                    transport={transport}
                    pageId={page.id}
                    system={selected}
                    navigate={go}
                  />
                ) : (
                  <p role="alert">This page is not in the selected design-system tree.</p>
                )}
              </div>
            )}
          </>
        ) : (
          <Suspense fallback={<p role="status">Loading design library…</p>}>
            <DesignDocs base={base} path={path} navigate={navigate} />
          </Suspense>
        )}
      </section>
      {creating && transport.management && (
        <DesignSystemDialog
          transport={transport}
          onDismiss={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            void refresh().then((ok) => {
              if (ok) go(`${base}/systems/${encodeURIComponent(id)}`);
            });
          }}
        />
      )}
    </>
  );
}
