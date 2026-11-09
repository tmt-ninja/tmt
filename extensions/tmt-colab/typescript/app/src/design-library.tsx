import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { BrowserAction, BrowserMenu } from '@tmt/browser-ui/react';
import type { PageTransport } from './transport.js';
import {
  listDesignSystems,
  pinDesignTree,
  publishNext,
  type DesignSystemEntry,
  type DesignTreeNode,
} from './design-system-pages.js';
import { DesignSystemDialog } from './design-system-ui.js';
import { DesignHeader } from './design-header.js';
import { DesignPage, designPageHref } from './design-page.js';
import { builtInDesign, type BuiltInDesign } from './design-built-in.js';
import { ShownReleaseContext } from './embedded-page.js';
const DesignDocs = lazy(() =>
  import('@tmt/browser-ui/docs-embed').then((module) => ({
    default: module.DesignDocs,
  })),
);
import { designBase } from './entry.js';
import { browserUiClasses } from '@tmt/browser-ui/static';
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
function findPage(
  node: DesignTreeNode,
  matches: (node: DesignTreeNode) => boolean,
): DesignTreeNode | undefined {
  return matches(node)
    ? node
    : node.children.map((child) => findPage(child, matches)).find(Boolean);
}
function Tree({
  node,
  current,
  system,
  base,
  navigate,
  root = false,
}: {
  node: DesignTreeNode;
  /** The tree's root: the header already names the system, so the root reads Introduction (#6060). */
  root?: boolean;
  current: string;
  system: DesignSystemEntry;
  base: string;
  navigate(href: string): void;
}) {
  const prefix = system.prefix;
  // The built-in tree is the docs nav: its sections are the top level, Introduction included.
  if (root && system.builtIn)
    return node.children.map((child) => (
      <Tree
        key={child.id}
        node={child}
        current={current}
        system={system}
        base={base}
        navigate={navigate}
      />
    ));
  // A built-in section groups pages, as the docs nav does; it is a heading, not a page.
  if (node.kind === 'section')
    return (
      <li className="design-page-tree-section">
        <p>{node.title}</p>
        <ul>
          {node.children.map((child) => (
            <Tree
              key={child.id}
              node={child}
              current={current}
              system={system}
              base={base}
              navigate={navigate}
            />
          ))}
        </ul>
      </li>
    );
  const href = designPageHref(system, base, node);
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
        {root ? 'Introduction' : node.title}
        {node.tag && <span className="design-page-tree-tag">{`${prefix}-${node.tag}`}</span>}
      </a>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Tree
              key={child.id}
              node={child}
              current={current}
              system={system}
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
  anchor,
  navigate,
}: {
  transport: PageTransport;
  path: string;
  /** The open page's anchor, if the link named one. */
  anchor?: string;
  navigate(href: string): void;
}) {
  const base = designBase();
  const [systems, setSystems] = useState<DesignSystemEntry[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // The release the header shows for each system in place of its draft (#5967).
  const [shown, setShown] = useState<Readonly<Record<string, string>>>({});
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
      const listed = await listDesignSystems(transport, controller.signal);
      if (controller.signal.aborted) return false;
      setSystems(listed.systems);
      setUnreadable(listed.unreadable);
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
  // The built-in tmt GUI ships with the build: `/ds/gui` draws it by docs path, with no pages to
  // make or sync first.
  const [builtIn, setBuiltIn] = useState<BuiltInDesign>();
  useEffect(() => {
    let live = true;
    void builtInDesign().then((loaded) => {
      if (live) setBuiltIn(loaded);
    });
    return () => {
      live = false;
    };
  }, []);
  const guiPath = path === `${base}/ds/gui` || path.startsWith(`${base}/ds/gui/`);
  // Design opens at the tmt GUI, as the docs site does.
  const atRoot = path === base || path === `${base}/`;
  useEffect(() => {
    if (atRoot) navigate(`${base}/ds/gui`);
  }, [atRoot, base, navigate]);
  const selected =
    (guiPath ? builtIn?.entry : undefined) ??
    systems?.find(
      (entry) =>
        path === `${base}/systems/${encodeURIComponent(entry.id)}` ||
        path.startsWith(`${base}/systems/${encodeURIComponent(entry.id)}/`),
    );
  const userPath = path.startsWith(`${base}/systems/`);
  const pagePart = selected
    ? path
        .slice(
          selected.builtIn
            ? `${base}/ds/gui`.length
            : `${base}/systems/${encodeURIComponent(selected.id)}`.length,
        )
        .replace(/^\//, '')
    : '';
  const page = selected
    ? pagePart
      ? findPage(selected.tree, (node) =>
          selected.builtIn
            ? node.kind !== 'section' && node.key === decodeURIComponent(pagePart)
            : encodeURIComponent(node.id) === pagePart,
        )
      : selected.tree
    : undefined;
  const builtin = path.startsWith(`${base}/ds/tui`) ? 'tui' : 'gui';
  const current =
    selected && !selected.builtIn ? `user:${selected.id}` : userPath ? 'unknown' : builtin;
  // One publish at a time: a second activation before the first re-renders would upload a second
  // bundle and then fail on a stale base, leaving an orphan attachment.
  const publishingNow = useRef(false);
  const [unpinned, setUnpinned] = useState<{ pin: string; pages: string[] }>();
  const run = async (task: () => Promise<void>) => {
    if (!selected || !transport.management || publishingNow.current) return;
    publishingNow.current = true;
    setPublishing(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await task();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      publishingNow.current = false;
      setPublishing(false);
    }
  };
  const publish = () =>
    run(async () => {
      const result = await publishNext(transport, selected!.id);
      setNotice(`Published ${result.version}.`);
      setUnpinned(result.unpinned.length ? { pin: result.pin, pages: result.unpinned } : undefined);
      await refresh();
    });
  const repin = () =>
    run(async () => {
      const pages = await pinDesignTree(transport, selected!.id);
      setUnpinned(pages.length ? { pin: unpinned!.pin, pages } : undefined);
      if (!pages.length) setNotice('Every page now follows the draft.');
    });
  // The workspace is the scroller here, so a new page starts at its top.
  const open = (href: string) => {
    navigate(href);
    if (workspace.current) workspace.current.scrollTop = 0;
  };
  const shownVersion = selected && shown[selected.id];
  const shownRelease = useCallback(
    (system: string) => (system === selected?.id ? shownVersion : undefined),
    [selected?.id, shownVersion],
  );
  const go = (href: string) => {
    setNavOpen(false);
    open(href);
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
            {selected && !selected.builtIn && (
              <BrowserMenu
                label="Shown version"
                valueLabel={shownVersion ? `Release ${shownVersion}` : 'Draft'}
                items={[
                  {
                    key: '',
                    label: 'Draft',
                    role: 'menuitemradio' as const,
                    checked: !shownVersion,
                  },
                  ...[...selected.config.releases].reverse().map((release) => ({
                    key: release.version,
                    label: `Release ${release.version}`,
                    role: 'menuitemradio' as const,
                    checked: release.version === shownVersion,
                  })),
                ]}
                onSelect={(version) => {
                  const { [selected.id]: _left, ...rest } = shown;
                  setShown(version ? { ...rest, [selected.id]: version } : rest);
                }}
              />
            )}
            {page && !selected?.builtIn && (
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
                <span className="design-new-system">
                  <BrowserAction
                    type="button"
                    variant="secondary"
                    label="New design system"
                    leadingIcon={<Plus aria-hidden="true" />}
                    disabled={publishing || loading}
                    onActivate={() => {
                      setNotice(undefined);
                      setCreating(true);
                    }}
                  />
                </span>
                {selected && !selected.builtIn && (
                  <BrowserAction
                    type="button"
                    variant="primary"
                    label={`Publish ${selected.next}`}
                    disabled={publishing || loading || error !== undefined}
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
        {unreadable.length > 0 && (
          <p className="design-feedback" role="alert">
            {`Could not read ${unreadable.length === 1 ? 'this design system page' : 'these design system pages'}: ${unreadable.join(', ')}.`}{' '}
            <BrowserAction
              type="button"
              variant="text"
              label="Reload design systems"
              onActivate={() => void refresh()}
            />
          </p>
        )}
        {unpinned && (
          <p className="design-feedback" role="alert">
            {`Published, but these pages do not follow the draft yet: ${unpinned.pages.join(', ')}.`}{' '}
            <BrowserAction
              type="button"
              variant="text"
              label="Retry moving them"
              disabled={publishing}
              onActivate={() => void repin()}
            />
          </p>
        )}
        {notice && (
          <p className="design-feedback" role="status">
            {notice}
          </p>
        )}
        {userPath || guiPath || atRoot || selected ? (
          <>
            {userPath && loading && <p role="status">Loading design systems…</p>}
            {userPath && !loading && !error && !selected && (
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
                      root
                      node={selected.tree}
                      current={page?.id ?? ''}
                      system={selected}
                      base={base}
                      navigate={go}
                    />
                  </ul>
                </nav>
                {page ? (
                  <ShownReleaseContext.Provider value={shownRelease}>
                    <DesignPage
                      key={`${page.id}@${shownVersion ?? 'draft'}`}
                      transport={transport}
                      pageId={page.id}
                      shipped={selected.builtIn ? builtIn?.page(page.id) : undefined}
                      system={selected}
                      base={base}
                      anchor={anchor}
                      navigate={go}
                    />
                  </ShownReleaseContext.Provider>
                ) : (
                  <p role="alert">This page is not in the selected design-system tree.</p>
                )}
              </div>
            )}
          </>
        ) : (
          <Suspense fallback={<p role="status">Loading design library…</p>}>
            <DesignDocs base={base} path={path} navigate={open} />
          </Suspense>
        )}
      </section>
      {creating && transport.management && (
        <DesignSystemDialog
          transport={transport}
          onDismiss={() => setCreating(false)}
          onCreated={(id, open) => {
            if (open) setCreating(false);
            void refresh().then((ok) => {
              if (ok && open) go(`${base}/systems/${encodeURIComponent(id)}`);
            });
          }}
        />
      )}
    </>
  );
}
