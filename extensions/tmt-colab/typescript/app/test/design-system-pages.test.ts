import { describe, expect, it, vi } from 'vite-plus/test';
import type { DesignSystemConfig } from '../../../../../design/systems/compiler.mjs';
import {
  bundleHash,
  checkPageElements,
  DesignDraftError,
  noticeFrame,
  PIN_WAIT_MS,
} from '../src/design-system.js';
import { elements as colabElements } from '../../../contracts/vectors/page-elements-v1.json';
import type { Bundle } from '../../../../../design/systems/compiler.mjs';
import {
  builtInDesign,
  builtInLink,
  ensureBuiltInDiscussion,
  findBuiltInDiscussion,
} from '../src/design-built-in.js';
import {
  adoptDesignSystem,
  createDesignSystem,
  DESIGN_PROJECT,
  listDesignSystems,
  nextVersion,
  compileDraft,
  CREATE_WRITES,
  designSystemCreation,
  DRAFT_SETTLE_MS,
  pageDesignSystems,
  pinDesignTree,
  publishDesignSystem,
  publishNext,
  readBlock,
  withoutDesignSystems,
  writeBlock,
  writePin,
} from '../src/design-system-pages.js';
import type { PageBinding, PageTransport } from '../src/transport.js';
import templateSections from '../../../../../design/systems/tmt-gui/generated/pages.json';

/** #5821 / epic #5866: design systems as ordinary pages, over an in-memory space whose pages
 * hold source, sub-pages and attachments the way the live bindings do. */
/** `summaries` lists each page with the owner's fresh summary: its sub-page count and its parent. */
function space({ summaries = false }: { summaries?: boolean } = {}) {
  const pages = new Map<
    string,
    {
      title: string;
      source: string;
      order: string[];
      projects: string[];
      attachments: { id: string; bytes: Uint8Array }[];
      archived?: boolean;
    }
  >();
  let next = 0;
  // Live views the way a binding publishes them: every edit reaches the page's subscribers.
  const subscribers = new Map<string, Set<(view: { source: string }) => void>>();
  const open = { count: 0, edits: 0, total: 0 };
  // The owner's live page list: every page's revision moves on each write, and every watcher
  // hears the whole map, as the mounted transport's held list read delivers it.
  const revisions = new Map<string, number>();
  const listWatchers = new Set<(latest: ReadonlyMap<string, string>) => void>();
  const listed = () => new Map([...pages.keys()].map((id) => [id, `v1:${revisions.get(id) ?? 0}`]));
  const moved = (id: string) => {
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
    const latest = listed();
    for (const watcher of listWatchers) watcher(latest);
  };
  /** A write no browser binding sees, as `tmt colab page patch` makes on an unopened page. */
  const write = (id: string, source: string) => {
    pages.get(id)!.source = source;
    moved(id);
  };
  const make = (title: string) => {
    const id = `page-${++next}`;
    pages.set(id, { title, source: `<h1>${title}</h1>`, order: [], projects: [], attachments: [] });
    return id;
  };
  const binding = (id: string): PageBinding => {
    const page = () => pages.get(id)!;
    return {
      close: () => {
        open.count--;
      },
      subscribe: (publish: (view: { source: string }) => void) => {
        const set = subscribers.get(id) ?? new Set();
        subscribers.set(id, set);
        set.add(publish);
        return () => set.delete(publish);
      },
      // As the binding does, an edit onto a page that moved since `base` merges; here the
      // later write wins.
      edit: async (source: string, base: string) => {
        const merged = base !== page().source;
        page().source = source;
        open.edits++;
        for (const publish of subscribers.get(id) ?? []) publish({ source });
        moved(id);
        return { merged };
      },
      work: async (action: string, body: Record<string, unknown>) => {
        if (action === 'subpage.detach') {
          page().order = page().order.filter((child) => child !== body.pageId);
          return {};
        }
        if (action !== 'subpage.create') throw new Error(action);
        const child = make(String(body.title));
        page().order.push(child);
        return { childPage: child };
      },
      files: {
        target: () => ({ kind: 'document', source: page().source }),
        add: async (stored: { original: { descriptor: { attachmentId: string } } }[]) => {
          for (const entry of stored)
            page().attachments.push({
              id: entry.original.descriptor.attachmentId,
              bytes: (entry as unknown as { bytes: Uint8Array }).bytes,
            });
        },
        attachments: {
          settle: async () => {},
          upload: async (input: { bytes: Uint8Array }) => ({
            original: { descriptor: { attachmentId: `att-${++next}` } },
            bytes: input.bytes,
          }),
          open: async (_reference: unknown, descriptor: { attachmentId: string }) =>
            page().attachments.find((entry) => entry.id === descriptor.attachmentId)!.bytes,
        },
      },
    } as unknown as PageBinding;
  };
  const summaryOf = (id: string) => {
    const live = pages.get(id)!.order.filter((child) => !pages.get(child)!.archived);
    const parent = [...pages].find(([, page]) => page.order.includes(id));
    return {
      comments: 0,
      waiting: false,
      needsYou: 0,
      ...(live.length && { work: { stage: 'in-progress', done: 0, total: live.length } }),
      ...(parent && { parent: { page: parent[0], index: parent[1].order.indexOf(id) } }),
    };
  };
  const transport = {
    watchPages: (changed: (latest: ReadonlyMap<string, string>) => void) => {
      listWatchers.add(changed);
      queueMicrotask(() => listWatchers.has(changed) && changed(listed()));
      return () => listWatchers.delete(changed);
    },
    page: async (id: string) => {
      const page = pages.get(id);
      if (!page) throw new Error('Page unavailable');
      open.count++;
      open.total++;
      return {
        id,
        title: page.title,
        source: page.source,
        work: { version: 2, order: [...page.order] },
        binding: binding(id),
        attachments: page.attachments.map((entry) => ({ attachmentId: entry.id })),
      };
    },
    spaceHome: async () => ({
      title: 'Space',
      projects: [...new Set([...pages.values()].flatMap((page) => page.projects))],
      pages: [...pages].map(([id, page]) => ({
        id,
        title: page.title,
        sharing: 'private',
        projects: [...page.projects],
        ...(page.archived && { archived: true }),
        ...(summaries && { summary: summaryOf(id) }),
      })),
    }),
    management: {
      // Archive as the page list runs it: read, sign, send, verify.
      read: async (pageId: string) => ({ pageId }),
      prepare: async (_view: unknown, selection: unknown) => selection,
      send: async () => ({}),
      verify: async (pending: { operation: string; value: { pageId: string } }) => {
        if (pending.operation === 'page.archive') pages.get(pending.value.pageId)!.archived = true;
      },
      setProjects: async (changes: { pageId: string; projects: string[] }[]) => {
        // As the real client refuses: one request lists its pages in ID order.
        const order = changes.map((change) => change.pageId);
        if (order.join() !== [...order].sort().join())
          throw new Error('Invalid colab-v1 value or proof');
        for (const change of changes) pages.get(change.pageId)!.projects = [...change.projects];
      },
    },
  } as unknown as PageTransport;
  return { pages, make, binding, transport, open, write, listWatchers };
}

describe('data blocks', () => {
  it('reads, writes and replaces a block and a pin without breaking out of the element', () => {
    const value = { note: '</script><script>alert(1)</script>' };
    const source = writeBlock('<p>Docs</p>', 'component', value);
    expect(source).not.toContain('</script><script>');
    expect(readBlock(source, 'component')).toEqual(value);
    const again = writeBlock(source, 'component', { note: 'x' });
    expect(again.match(/data-tmt-ds="component"/g)).toHaveLength(1);
    expect(readBlock(again, 'component')).toEqual({ note: 'x' });
    expect(readBlock('<p>no block</p>', 'component')).toBeUndefined();
    const pinned = writePin(writePin('<p>x</p>', 'a@0.1.0#sha256-1'), 'a@0.1.1#sha256-2');
    expect(pinned.match(/name="tmt-ds"/g)).toHaveLength(1);
    expect(pinned).toContain('a@0.1.1#sha256-2');
  });

  it('counts the next patch version from the latest release', () => {
    const config = { version: '0.1.0', releases: [] } as unknown as DesignSystemConfig;
    expect(nextVersion(config)).toBe('0.1.0');
    expect(nextVersion({ ...config, releases: [{ version: '0.1.4' }] } as DesignSystemConfig)).toBe(
      '0.1.5',
    );
  });
});

describe('template, publish and the renderer source', () => {
  /** The space's page reads, with each edit taking a moment the way a page connection does. */
  const slowEdits = (transport: PageTransport, edited: (id: string) => void = () => {}) => {
    const page = transport.page.bind(transport);
    (transport as { page: PageTransport['page'] }).page = async (id, signal) => {
      const snapshot = await page(id, signal);
      const binding = snapshot.binding as { edit: (...args: unknown[]) => Promise<unknown> };
      const edit = binding.edit;
      binding.edit = async (...args) => {
        edited(id);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return edit(...args);
      };
      return snapshot;
    };
  };

  it('makes the pages in template order and writes at most CREATE_WRITES at once (#6162)', async () => {
    const { pages, make, transport, open } = space();
    make('Home');
    slowEdits(transport);
    let writing = false;
    let publishing = false;
    let peak = 0;
    const publishOpened = new Set<string>();
    const page = transport.page.bind(transport);
    (transport as { page: PageTransport['page'] }).page = async (id, signal) => {
      const snapshot = await page(id, signal);
      if (writing) peak = Math.max(peak, open.count);
      if (publishing) publishOpened.add(id);
      return snapshot;
    };
    const progress: string[] = [];
    const rootId = await designSystemCreation(transport, { name: 'Acme', prefix: 'acme' }).run(
      (state) => {
        writing = state.phase === 'pages';
        publishing = state.phase === 'publishing';
        progress.push(state.phase === 'pages' ? `${state.done}/${state.total}` : state.phase);
      },
    );
    expect(peak).toBe(CREATE_WRITES);
    const sections = templateSections as { title: string; pages: { title: string }[] }[];
    const total =
      sections.length + sections.reduce((sum, section) => sum + section.pages.length, 0);
    expect(progress[0]).toBe(`0/${total}`);
    expect(progress.at(-2)).toBe(`${total}/${total}`);
    expect(progress.at(-1)).toBe('publishing');
    // The first version compiles from what was just written: publishing opens only the root, and
    // its bundle is the one the pages compile to.
    expect([...publishOpened]).toEqual([rootId]);
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    expect((await compileDraft(transport, rootId, '0.1.0')).hash).toBe(config.releases[0]!.bundle);
    const titles = (ids: string[]) => ids.map((id) => pages.get(id)!.title);
    const root = pages.get(rootId)!;
    expect(titles(root.order)).toEqual(sections.map((section) => section.title));
    root.order.forEach((sectionId, index) => {
      expect(titles(pages.get(sectionId)!.order)).toEqual(
        sections[index]!.pages.map((doc) => doc.title),
      );
      // Each section lists its pages in that order.
      const links = [...pages.get(sectionId)!.source.matchAll(/href="\/p\/([^"]+)"/g)];
      expect(links.map((link) => link[1])).toEqual(pages.get(sectionId)!.order);
      // Every page is written following the draft, so publishing re-walks no page.
      for (const id of [sectionId, ...pages.get(sectionId)!.order])
        expect(pages.get(id)!.source).toContain(`<meta name="tmt-ds" content="${rootId}">`);
    });
  });

  it('stops writing after a failed page, names it, and a retry makes no page twice (#6162)', async () => {
    const clean = space();
    clean.make('Home');
    await createDesignSystem(clean.transport, { name: 'Acme', prefix: 'acme' });
    const { pages, make, transport } = space();
    make('Home');
    let writes = 0;
    let failed: string | undefined;
    let startedAfter = 0;
    slowEdits(transport, (id) => {
      if (failed) startedAfter++;
      if (++writes === 10 && !failed) {
        failed = pages.get(id)!.title;
        throw new Error('Socket closed');
      }
    });
    const creation = designSystemCreation(transport, { name: 'Acme', prefix: 'acme' });
    const refused = await creation.run().catch((error: Error) => error);
    expect(failed).toBeDefined();
    expect((refused as Error).message).toBe(`The ${failed} page was not written: Socket closed`);
    // Only the writes already in flight finish; no new one starts.
    expect(startedAfter).toBeLessThan(CREATE_WRITES);
    const rootId = await creation.run();
    expect(pages.size).toBe(clean.pages.size);
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    expect(config.releases).toHaveLength(1);
    const failedPage = [...pages.values()].find((page) => page.title === failed)!;
    expect(failedPage.source).not.toBe(`<h1>${failed}</h1>`);
  });

  it('on an older serve makes a top-level system under a borrowed page, publishes, pins every page and serves the bundle', async () => {
    const { pages, make, transport } = space();
    const home = make('Home');
    pages.get(home)!.projects = ['Notes'];
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    // The borrowed parent keeps no row: the system is its own tree.
    expect(pages.get(home)!.order).toEqual([]);
    expect(pages.get(home)!.projects).toEqual(['Notes']);
    const root = pages.get(rootId)!;
    const config = readBlock<DesignSystemConfig>(root.source, 'design-system')!;
    expect(config).toMatchObject({ name: 'Acme', prefix: 'acme', id: rootId, version: '0.1.0' });
    expect(config.releases).toHaveLength(1);
    const [release] = config.releases;
    // The tree follows the draft (#5967): every page names the system without a lock.
    const pin = rootId;
    expect(root.source).toContain(`<meta name="tmt-ds" content="${pin}">`);
    const buttonId = config.components.find((entry) => entry.tag === 'button')!.page!;
    const button = pages.get(buttonId)!;
    expect(button.source).toContain(`content="${pin}">`);
    expect(button.source).toContain('<acme-button variant="outline">');
    expect(readBlock(button.source, 'component')).toMatchObject({ tag: 'button' });
    for (const id of [rootId, buttonId]) expect(pages.get(id)!.projects).toEqual([DESIGN_PROJECT]);
    // The renderer reads the release attachment and the bundle verifies against its pin.
    const bundle = await pageDesignSystems(transport).release(rootId, {
      version: '0.1.0',
      hash: release!.bundle,
    });
    expect(bundle!.components.map((component) => component.tag).sort()).toEqual([
      'acme-action',
      'acme-alert',
      'acme-badge',
      'acme-block',
      'acme-block-document',
      'acme-block-mention',
      'acme-block-menu',
      'acme-block-toast',
      'acme-brand-mark',
      'acme-browser-avatar',
      'acme-browser-checkbox',
      'acme-browser-chips',
      'acme-browser-command',
      'acme-browser-tabs',
      'acme-busy-mark',
      'acme-button',
      'acme-callout',
      'acme-card',
      'acme-card-block',
      'acme-card-meter',
      'acme-chart',
      'acme-checkbox',
      'acme-chips',
      'acme-choice',
      'acme-code-block',
      'acme-command',
      'acme-count-chip',
      'acme-data-table',
      'acme-dialog',
      'acme-dialog-drawer-panel',
      'acme-disclosure',
      'acme-dropdown-menu',
      'acme-ds-scope',
      'acme-editorial',
      'acme-empty',
      'acme-field',
      'acme-floating',
      'acme-foundation',
      'acme-header',
      'acme-heading-block',
      'acme-icon-action',
      'acme-image-block',
      'acme-input',
      'acme-list',
      'acme-list-item',
      'acme-menu',
      'acme-message-row',
      'acme-mockup-block',
      'acme-notice',
      'acme-notifications',
      'acme-overview',
      'acme-page-list',
      'acme-page-row',
      'acme-page-view',
      'acme-pager',
      'acme-pattern',
      'acme-popover',
      'acme-question-block',
      'acme-rich-input',
      'acme-section',
      'acme-select',
      'acme-separator',
      'acme-sheet',
      'acme-shell',
      'acme-skeleton',
      'acme-status-line',
      'acme-status-tile',
      'acme-surface',
      'acme-switch',
      'acme-table',
      'acme-table-block',
      'acme-tabs',
      'acme-text-block',
      'acme-textarea',
      'acme-todo',
      'acme-toggle',
      'acme-tooltip',
      'acme-visually-hidden',
      'acme-work-band',
      'acme-work-bundle',
    ]);
    expect(await bundleHash(bundle!)).toBe(release!.bundle);
    // Publish from the Design header adds a version and moves the pins.
    const second = await publishNext(transport, rootId);
    expect(second.version).toBe('0.1.1');
    expect(readBlock<DesignSystemConfig>(root.source, 'design-system')!.releases).toHaveLength(2);
    // A release locks nothing in the tree: the component page still follows the draft.
    expect(button.source).toContain(`content="${rootId}">`);
    expect(second.pin).toBe(`${rootId}@0.1.1#${second.bundle.hash}`);
  });

  it('publishes each component with the examples its page shows', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const button = pages.get(config.components.find((entry) => entry.tag === 'button')!.page!)!;
    // The example root carries its anchor as its id (point-and-fix links open the page there).
    expect(button.source).toContain('<div id="button:primary" data-ds-example="button:primary">');
    const { bundle } = await publishNext(transport, rootId);
    const examples = bundle.components.map((component) => component.examples ?? []);
    expect(examples.every((list) => list.length > 0)).toBe(true);
    expect(examples.flat().length).toBeGreaterThan(30);
  });

  it('reports the tree pages a publish could not move to the draft, and retries them', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const stuck = config.components[0]!.page!;
    // A page locked to a release (made before the tree followed the draft).
    pages.get(stuck)!.source = writePin(
      pages.get(stuck)!.source,
      `${rootId}@0.1.0#${config.releases[0]!.bundle}`,
    );
    let refuse = true;
    const flaky = {
      ...transport,
      page: async (id: string) => {
        const page = await transport.page(id);
        if (id !== stuck || !refuse) return page;
        const binding = page.binding!;
        return {
          ...page,
          binding: {
            ...binding,
            edit: async () => {
              throw new Error('stale base');
            },
          },
        };
      },
    } as PageTransport;
    const result = await publishNext(flaky, rootId);
    expect(result.unpinned).toEqual([pages.get(stuck)!.title]);
    const follows = `<meta name="tmt-ds" content="${rootId}">`;
    expect(pages.get(stuck)!.source).not.toContain(follows);
    refuse = false;
    expect(await pinDesignTree(flaky, rootId)).toEqual([]);
    expect(pages.get(stuck)!.source).toContain(follows);
  });

  it('lists by opening one page at a time, each tree page once, and reports an unreadable root', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const acme = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const beta = await createDesignSystem(transport, { name: 'Beta', prefix: 'beta' });
    const opens = new Map<string, number>();
    let open = 0;
    let most = 0;
    const counted = {
      ...transport,
      page: async (id: string) => {
        opens.set(id, (opens.get(id) ?? 0) + 1);
        most = Math.max(most, ++open);
        try {
          if (id === beta) throw new Error('Page unavailable');
          return await transport.page(id);
        } finally {
          open--;
        }
      },
    } as PageTransport;
    const listed = await listDesignSystems(counted);
    expect(listed.systems.map((system) => system.id)).toEqual([acme]);
    expect(listed.unreadable).toEqual(['Beta']);
    expect(most).toBe(1);
    // Every Acme page once: as a tree page, never again as a candidate root.
    const acmeTree = [...pages.keys()].filter((id) => opens.has(id) && id !== beta);
    expect(acmeTree.length).toBeGreaterThan(20);
    for (const id of acmeTree) expect(opens.get(id), id).toBe(1);
  });

  it('lists a tree from the owner list, opening only the root and pages the list cannot place', async () => {
    const walked = space();
    walked.make('Notes');
    await createDesignSystem(walked.transport, { name: 'Acme', prefix: 'acme' });
    const listed = space({ summaries: true });
    listed.make('Notes');
    const rootId = await createDesignSystem(listed.transport, { name: 'Acme', prefix: 'acme' });
    const beta = await createDesignSystem(listed.transport, { name: 'Beta', prefix: 'beta' });
    const opened: string[] = [];
    // The owner orders its list its own way: here every sub-page comes before its root, and still
    // only the roots are opened.
    const counted = {
      ...listed.transport,
      spaceHome: async () => {
        const value = await listed.transport.spaceHome();
        return { ...value, pages: [...value.pages].reverse() };
      },
      page: (id: string) => (opened.push(id), listed.transport.page(id)),
    } as PageTransport;
    const system = (await listDesignSystems(counted)).systems.find((entry) => entry.id === rootId);
    expect(opened).toEqual([beta, rootId]);
    // The same tree as opening every page: titles, order, kinds and component tags.
    expect(system!.tree).toEqual((await listDesignSystems(walked.transport)).systems[0]!.tree);
    // A sub-page whose summary is not derived yet is opened, and only it.
    const components = system!.tree.children[1]!;
    const button = components.children.find((node) => node.tag === 'button')!;
    const home = counted.spaceHome;
    opened.length = 0;
    const partial = {
      ...counted,
      spaceHome: async () => {
        const value = await home();
        return {
          ...value,
          pages: value.pages.map((page) =>
            page.id === button.id ? { ...page, summary: undefined } : page,
          ),
        };
      },
    } as PageTransport;
    const again = (await listDesignSystems(partial)).systems.find((entry) => entry.id === rootId);
    expect(opened).toEqual([beta, rootId, components.id, button.id]);
    expect(again!.tree).toEqual(system!.tree);
  });

  it('lists systems with their tree for Design and hides them from the Colab list', async () => {
    const { make, transport } = space();
    const note = make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    // A second system starts from the first, never from an ordinary page.
    await createDesignSystem(transport, { name: 'Beta', prefix: 'beta' });
    const { systems, unreadable } = await listDesignSystems(transport);
    expect(unreadable).toEqual([]);
    expect(systems.map((system) => [system.name, system.version, system.next])).toEqual([
      ['Acme', '0.1.0', '0.1.1'],
      ['Beta', '0.1.0', '0.1.1'],
    ]);
    expect(systems[0]!.tree).toMatchObject({
      id: rootId,
      title: 'Acme',
      kind: 'design-system',
      // The tmt GUI docs by section; the components the template carries are live component pages.
      children: [
        { title: 'Foundations', kind: 'page' },
        { title: 'Components', kind: 'page' },
        { title: 'Browser components', kind: 'page' },
        { title: 'Patterns', kind: 'page' },
      ],
    });
    const [foundations, components, browser, patterns] = systems[0]!.tree.children;
    expect(foundations!.children.map((page) => page.title)).toContain('Colour');
    // Every page shows its title; a component page also names its tag.
    expect(components!.children.find((page) => page.title === 'Button')).toMatchObject({
      title: 'Button',
      tag: 'button',
    });
    expect(components!.children.length).toBeGreaterThan(20);
    expect(browser!.children.find((page) => page.tag === 'browser-avatar')).toMatchObject({
      title: 'Avatar',
      kind: 'component',
    });
    expect(patterns!.children.length).toBeGreaterThan(10);
    const listed = withoutDesignSystems(await transport.spaceHome());
    expect(listed.pages.map((page) => page.id)).toEqual([note]);
    expect(listed.projects).toEqual([]);
  });

  it('adopts an older system only when asked', async () => {
    const { pages, make, binding, transport } = space();
    const holder = make('Holder');
    const created = await binding(holder).work!('subpage.create', { title: 'Old' });
    const old = created.childPage!;
    pages.get(old)!.source = writeBlock('<p>docs</p>', 'design-system', {
      name: 'Old',
      prefix: 'old',
      version: '0.1.0',
      components: [],
      releases: [],
    });
    expect(await listDesignSystems(transport)).toEqual({ systems: [], unreadable: [] });
    await adoptDesignSystem(transport, old);
    expect((await listDesignSystems(transport)).systems.map((system) => system.id)).toEqual([old]);
    await expect(adoptDesignSystem(transport, holder)).rejects.toThrow('not a design system');
  });

  it('refuses to publish when a component page lost its block', async () => {
    const { pages, make, binding, transport } = space();
    make('Home');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const root = pages.get(rootId)!;
    const config = readBlock<DesignSystemConfig>(root.source, 'design-system')!;
    pages.get(config.components[0]!.page!)!.source = '<p>edited away</p>';
    await expect(
      publishDesignSystem(transport, rootId, binding(rootId), root.source, '0.1.1'),
    ).rejects.toThrow('has no component block');
  });
});

describe('live draft (#5967)', () => {
  // An edit of a component's CSS, the way a Design author changes a component page.
  const recolor = (source: string) => {
    const block = readBlock<{ css: string }>(source, 'component')!;
    return writeBlock(source, 'component', { ...block, css: `${block.css}.acme-draft-mark{}` });
  };
  it('compiles the draft as publish does, and locked pages keep their release', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const button = config.components.find((entry) => entry.tag === 'button')!.page!;
    const published = await publishNext(transport, rootId);
    expect((await compileDraft(transport, rootId, published.version)).hash).toBe(
      published.bundle.hash,
    );
    pages.get(button)!.source = recolor(pages.get(button)!.source);
    const source = pageDesignSystems(transport);
    const draft = await source.draft(rootId);
    expect(draft.components.find((entry) => entry.tag === 'acme-button')!.css).toContain(
      'acme-draft-mark',
    );
    const locked = await source.release(rootId, {
      version: published.version,
      hash: published.bundle.hash,
    });
    expect(locked!.components.find((entry) => entry.tag === 'acme-button')!.css).not.toContain(
      'acme-draft-mark',
    );
    // The Design header's release view reads that release for a live pin.
    const shown = await pageDesignSystems(transport, () => published.version).draft(rootId);
    expect(shown.hash).toBe(published.bundle.hash);
  });

  it('follows with one page open, hears component writes from the page list, settles a burst into one recompile, and closes on leave', async () => {
    const { pages, make, transport, open, write, listWatchers } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    expect(config.components.length).toBeGreaterThan(16);
    const button = config.components.find((entry) => entry.tag === 'button')!.page!;
    const card = config.components.find((entry) => entry.tag === 'card')!.page!;
    const source = pageDesignSystems(transport);
    const before = open.count;
    let changes = 0;
    const stop = source.watch(rootId, () => changes++);
    const first = await source.draft(rootId);
    expect(await source.draft(rootId)).toBe(first);
    // Whatever the system's size, the follow holds only its root open (#6162), and one list watch.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(open.count - before).toBe(1);
    expect(listWatchers.size).toBe(1);
    // Writes to two unopened component pages in a burst: one change once they settle.
    write(button, recolor(pages.get(button)!.source));
    write(card, `${pages.get(card)!.source}<!-- edit -->`);
    write(button, recolor(pages.get(button)!.source));
    expect(changes).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SETTLE_MS + 50));
    expect(changes).toBe(1);
    const opensBefore = open.total;
    const second = await source.draft(rootId);
    expect(second.hash).not.toBe(first.hash);
    // The recompile reads the root and the two pages that moved; every other doc is reused.
    expect(open.total - opensBefore).toBe(3);
    // A page outside the system moving does not change the draft.
    write(pages.keys().next().value!, '<h1>Notes again</h1>');
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SETTLE_MS + 50));
    expect(changes).toBe(1);
    stop();
    expect(open.count).toBe(before);
    expect(listWatchers.size).toBe(0);
  });

  it('the next open page of a system reuses the docs the last one read, even its first draft (#6177)', async () => {
    const { make, transport, open } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    // Each open page makes its own source; the first draft starts before the list has answered.
    const first = pageDesignSystems(transport);
    const stopFirst = first.watch(rootId, () => {});
    const drawn = await first.draft(rootId);
    stopFirst();
    const opensBefore = open.total;
    const next = pageDesignSystems(transport);
    const stop = next.watch(rootId, () => {});
    expect((await next.draft(rootId)).hash).toBe(drawn.hash);
    // Its follow's root and the draft's root: no component page is read again.
    expect(open.total - opensBefore).toBe(2);
    stop();
  });

  it('two pages drafting the same system at once read each component page once (#6177)', async () => {
    const { pages, make, transport, listWatchers } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const components = new Set(config.components.map((entry) => entry.page!));
    const reads = new Map<string, number>();
    const counted = {
      ...transport,
      page: (id: string) => {
        if (components.has(id)) reads.set(id, (reads.get(id) ?? 0) + 1);
        return transport.page(id);
      },
    } as PageTransport;
    // The system page is still compiling when the next page opens and drafts too.
    const first = pageDesignSystems(counted);
    const second = pageDesignSystems(counted);
    const stops = [first.watch(rootId, () => {}), second.watch(rootId, () => {})];
    await vi.waitFor(() => expect(listWatchers.size).toBe(2));
    const [a, b] = await Promise.all([first.draft(rootId), second.draft(rootId)]);
    expect(b.hash).toBe(a.hash);
    expect(reads.size).toBe(components.size);
    for (const [id, count] of reads) expect(count, id).toBe(1);
    for (const stop of stops) stop();
  });

  it('a transient watched-root open failure is retried before component edits', async () => {
    const { pages, make, transport, write, open } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const button = config.components.find((entry) => entry.tag === 'button')!.page!;
    let rootReads = 0;
    const transient = {
      ...transport,
      page: async (id: string) => {
        if (id === rootId && ++rootReads === 1) throw new Error('temporarily unavailable');
        return transport.page(id);
      },
    } as PageTransport;
    const source = pageDesignSystems(transient);
    let changes = 0;
    const stop = source.watch(rootId, () => changes++);
    const first = await source.draft(rootId);
    await vi.waitFor(() => expect(open.count).toBe(1), { timeout: 2000 });
    write(button, recolor(pages.get(button)!.source));
    await vi.waitFor(() => expect(changes).toBeGreaterThan(0), { timeout: 2000 });
    expect((await source.draft(rootId)).hash).not.toBe(first.hash);
    stop();
  });

  it('a first list arriving after an untracked draft invalidates it', async () => {
    const { pages, make, transport, write } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const button = config.components.find((entry) => entry.tag === 'button')!.page!;
    let release!: () => void;
    const delayed = {
      ...transport,
      watchPages: (changed: (latest: ReadonlyMap<string, string>) => void) => {
        let latest: ReadonlyMap<string, string> | undefined;
        let ready = false;
        release = () => {
          ready = true;
          if (latest) changed(latest);
        };
        return transport.watchPages!((next) => {
          latest = next;
          if (ready) changed(next);
        });
      },
    } as PageTransport;
    const source = pageDesignSystems(delayed);
    let changes = 0;
    const stop = source.watch(rootId, () => changes++);
    const first = await source.draft(rootId);
    write(button, recolor(pages.get(button)!.source));
    release();
    await vi.waitFor(() => expect(changes).toBeGreaterThan(0), { timeout: 2000 });
    expect((await source.draft(rootId)).hash).not.toBe(first.hash);
    stop();
  });

  it('a component write while the watched root is still opening invalidates an already drawn draft', async () => {
    const { pages, make, transport, write } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const button = config.components.find((entry) => entry.tag === 'button')!.page!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let rootReads = 0;
    const delayed = {
      ...transport,
      page: async (id: string) => {
        if (id === rootId && ++rootReads === 1) await gate;
        return transport.page(id);
      },
    } as PageTransport;
    const source = pageDesignSystems(delayed);
    let changes = 0;
    const stop = source.watch(rootId, () => changes++);
    const first = await source.draft(rootId);
    write(button, recolor(pages.get(button)!.source));
    release();
    await vi.waitFor(() => expect(changes).toBeGreaterThan(0), { timeout: 2000 });
    expect((await source.draft(rootId)).hash).not.toBe(first.hash);
    stop();
  });

  it('a component write after the list arrived before the root loaded still changes the draft', async () => {
    const { pages, make, transport, write } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const button = config.components.find((entry) => entry.tag === 'button')!.page!;
    // The root opens slowly: the live list's first answer comes first.
    const slow = {
      ...transport,
      page: async (id: string) => {
        if (id === rootId) await new Promise((resolve) => setTimeout(resolve, 30));
        return transport.page(id);
      },
    } as PageTransport;
    let changes = 0;
    const stop = pageDesignSystems(slow).watch(rootId, () => changes++);
    await new Promise((resolve) => setTimeout(resolve, 60));
    write(button, recolor(pages.get(button)!.source));
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SETTLE_MS + 50));
    expect(changes).toBe(1);
    stop();
  });

  it('a draft slower than a page waits for tells its followers once, so they draw it (#6162)', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const button = config.components.find((entry) => entry.tag === 'button')!.page!;
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow = {
      ...transport,
      page: async (id: string) => {
        if (id === button) await held;
        return transport.page(id);
      },
    } as PageTransport;
    try {
      const source = pageDesignSystems(slow);
      let changes = 0;
      const stop = source.watch(rootId, () => changes++);
      const draft = source.draft(rootId);
      // The page gave up waiting; the compile finishes later and the followers hear of it once.
      now += PIN_WAIT_MS;
      release();
      const bundle = await draft;
      expect(changes).toBe(1);
      // Drawing again reuses that draft and tells no one.
      expect(await source.draft(rootId)).toBe(bundle);
      expect(changes).toBe(1);
      stop();
      // A draft in time tells no one.
      const quick = pageDesignSystems(transport);
      let quickChanges = 0;
      const stopQuick = quick.watch(rootId, () => quickChanges++);
      await quick.draft(rootId);
      expect(quickChanges).toBe(0);
      stopQuick();
    } finally {
      clock.mockRestore();
    }
  });

  it('draws the notice, never a blank page, when the draft is broken', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const button = config.components.find((entry) => entry.tag === 'button')!.page!;
    pages.get(button)!.source = '<h1>Button</h1>';
    const broken = pageDesignSystems(transport).draft(rootId);
    await expect(broken).rejects.toBeInstanceOf(DesignDraftError);
    await expect(broken).rejects.toThrow('The button page has no component block.');
    // The renderer turns it into the page's notice (loadDesignSystem, browser-only DOMParser).
    const frame = noticeFrame('draft-broken', 'The button page has no component block.');
    expect(frame.script).toContain('data-tmt-ds-notice');
    expect(frame.script).toContain('does not compile. Fix it in Design. The button page');
  });
});

describe('the built-in tmt GUI in Design (#6060)', () => {
  it('draws from what the build ships, by docs path, and writes no pages', async () => {
    const { pages, make, transport, open } = space();
    make('Notes');
    const before = pages.size;
    const { entry, page } = await builtInDesign();
    expect(entry.builtIn).toBe(true);
    // The tree is the docs site's own nav, Principles included, with no tag lines.
    expect(entry.tree.children.map((node) => [node.kind, node.title])).toEqual([
      ['section', 'Getting started'],
      ['section', 'Tokens'],
      ['section', 'Components'],
      ['section', 'Browser components'],
      ['section', 'Patterns'],
    ]);
    expect(entry.tree.children[0]!.children.map((node) => [node.key, node.title])).toEqual([
      ['', 'Introduction'],
      ['principles', 'Principles'],
    ]);
    expect(page('principles')!.source).toContain('Red is rare');
    const button = entry.tree.children[2]!.children.find(
      (node) => node.id === 'components/button',
    )!;
    expect(button).toEqual({
      id: 'components/button',
      key: 'components/button',
      title: 'Button',
      kind: 'page',
      children: [],
    });
    expect(entry.tree.children[3]!.children.map((node) => node.id)).toContain('browser/avatar');
    const source = page('components/button')!.source;
    expect(source).toContain('<meta name="tmt-ds" content="tmt-gui">');
    expect(source).toContain('<tmt-ui-component-docs page="components/button">');
    expect(page('')!.source).toContain(`href="${builtInLink('components/button')}"`);
    expect(pages.size).toBe(before);
    expect(open.edits).toBe(0);
    expect((await listDesignSystems(transport)).systems).toEqual([]);
  });

  it('makes one discussion page for a docs path on its first comment, and finds it after', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const shipped = (await builtInDesign()).page('components/button')!;
    expect(await findBuiltInDiscussion(transport, 'components/button', shipped.title)).toBe(
      undefined,
    );
    const id = await ensureBuiltInDiscussion(transport, 'components/button', shipped);
    const made = pages.get(id)!;
    expect(made.title).toBe('Button · tmt GUI');
    expect(made.projects).toEqual([DESIGN_PROJECT]);
    expect(readBlock(made.source, 'annotates')).toEqual({
      system: 'tmt-gui',
      path: 'components/button',
    });
    expect(made.source).toContain(shipped.source);
    expect(await ensureBuiltInDiscussion(transport, 'components/button', shipped)).toBe(id);
    expect(await findBuiltInDiscussion(transport, 'components/button', shipped.title)).toBe(id);
    // Another path's page is its own, and none of them is a design system.
    const badge = (await builtInDesign()).page('components/badge')!;
    expect(await ensureBuiltInDiscussion(transport, 'components/badge', badge)).not.toBe(id);
    expect((await listDesignSystems(transport)).systems).toEqual([]);
  });

  /** The live discussion pages for a docs path. */
  const liveDiscussions = (pages: ReturnType<typeof space>['pages']) =>
    [...pages]
      .filter(([, page]) => !page.archived && readBlock(page.source, 'annotates'))
      .map(([id]) => id);
  /** Another tab on the same space: its own transport object over the same pages. */
  const otherTab = (transport: PageTransport) => ({ ...transport }) as PageTransport;

  it('two first comments at once (two tabs) leave one live page for the path', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const shipped = (await builtInDesign()).page('components/button')!;
    // Both tabs find no page before either makes one.
    const tab = otherTab(transport);
    let arrivals = 0;
    let release!: () => void;
    const together = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const each of [transport, tab]) {
      const home = each.spaceHome;
      each.spaceHome = async (...args) => {
        const snapshot = await home(...args);
        if (++arrivals <= 2) {
          if (arrivals === 2) release();
          await together;
        }
        return snapshot;
      };
    }
    const [first, second] = await Promise.all([
      ensureBuiltInDiscussion(transport, 'components/button', shipped),
      ensureBuiltInDiscussion(tab, 'components/button', shipped),
    ]);
    expect(second).toBe(first);
    expect(liveDiscussions(pages)).toEqual([first]);
  });

  it('a tab that finishes before the other marks its lower page still ends with one page', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const shipped = (await builtInDesign()).page('components/button')!;
    // Tab B makes its page first (the lower id) but its edit waits until tab A is done.
    const tab = otherTab(transport);
    let stalled!: () => void;
    const atEdit = new Promise<void>((resolve) => {
      stalled = resolve;
    });
    let resume!: () => void;
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    tab.page = async (id) => {
      const opened = await transport.page(id);
      const binding = opened.binding!;
      return {
        ...opened,
        binding: {
          ...binding,
          edit: async (...args: Parameters<typeof binding.edit>) => {
            stalled();
            await resumed;
            return binding.edit(...args);
          },
        } as typeof binding,
      };
    };
    const second = ensureBuiltInDiscussion(tab, 'components/button', shipped);
    await atEdit;
    // Tab A sees no finished page, makes its own and keeps it.
    const first = await ensureBuiltInDiscussion(transport, 'components/button', shipped);
    expect(liveDiscussions(pages)).toEqual([first]);
    resume();
    const kept = await second;
    expect(kept < first).toBe(true);
    // B archived A's page, not only its own; A's next look finds B's.
    expect(liveDiscussions(pages)).toEqual([kept]);
    expect(await findBuiltInDiscussion(transport, 'components/button', shipped.title)).toBe(kept);
  });

  it('a double press in one tab makes one page', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const shipped = (await builtInDesign()).page('components/button')!;
    const before = pages.size;
    const [first, second] = await Promise.all([
      ensureBuiltInDiscussion(transport, 'components/button', shipped),
      ensureBuiltInDiscussion(transport, 'components/button', shipped),
    ]);
    expect(second).toBe(first);
    expect(pages.size).toBe(before + 1);
    expect(liveDiscussions(pages)).toEqual([first]);
  });

  it('a page whose Design mark fails is archived, and the next press makes a working one', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const shipped = (await builtInDesign()).page('components/button')!;
    const management = transport.management!;
    const setProjects = management.setProjects;
    management.setProjects = async () => {
      throw new Error('Mark failed');
    };
    const before = pages.size;
    await expect(ensureBuiltInDiscussion(transport, 'components/button', shipped)).rejects.toThrow(
      'Mark failed',
    );
    expect(pages.size).toBe(before + 1);
    expect([...pages.values()].filter((page) => !page.archived).length).toBe(before);
    management.setProjects = setProjects;
    const id = await ensureBuiltInDiscussion(transport, 'components/button', shipped);
    expect(liveDiscussions(pages)).toEqual([id]);
  });
});

describe('the design-system page check on a Colab page (#6062)', () => {
  it('skips every Colab page element and still reports a foreign tag', async () => {
    const bundle = (await import('../../../../../design/systems/tmt-gui/generated/bundle.json'))
      .default as unknown as Bundle;
    const pin = { system: 'tmt-gui' };
    const el = (tag: string) => ({ tag, attrs: {} });
    expect(colabElements).toEqual(
      expect.arrayContaining([
        'tmt-question',
        'tmt-questions',
        'tmt-review',
        'tmt-read',
        'tmt-thread-ref',
      ]),
    );
    const page = [...colabElements.map(el), el('tmt-ui-button')];
    expect(checkPageElements(page, pin, bundle)).toEqual([]);
    expect(checkPageElements([...page, el('acme-button')], pin, bundle)).toEqual([
      { code: 'ds-prefix-mismatch', tag: 'acme-button', index: page.length },
    ]);
  });
});
