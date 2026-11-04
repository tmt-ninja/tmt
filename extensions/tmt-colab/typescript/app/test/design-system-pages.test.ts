import { describe, expect, it } from 'vite-plus/test';
import type { DesignSystemConfig } from '../../../../../design/systems/compiler.mjs';
import {
  bundleHash,
  checkPageElements,
  DesignDraftError,
  noticeFrame,
} from '../src/design-system.js';
import { elements as colabElements } from '../../../contracts/vectors/page-elements-v1.json';
import type { Bundle } from '../../../../../design/systems/compiler.mjs';
import { GENERATED_NOTE, shippedBundle, syncBuiltInMirror } from '../src/design-mirror.js';
import {
  adoptDesignSystem,
  createDesignSystem,
  DESIGN_PROJECT,
  listDesignSystems,
  nextVersion,
  compileDraft,
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

/** #5821 / epic #5866: design systems as ordinary pages, over an in-memory space whose pages
 * hold source, sub-pages and attachments the way the live bindings do. */
function space() {
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
  const open = { count: 0, edits: 0 };
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
  const transport = {
    page: async (id: string) => {
      const page = pages.get(id);
      if (!page) throw new Error('Page unavailable');
      open.count++;
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
  return { pages, make, binding, transport, open };
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
    const buttonId = config.components[0]!.page!;
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
      'acme-header',
      'acme-heading-block',
      'acme-icon-action',
      'acme-image-block',
      'acme-input',
      'acme-list',
      'acme-list-item',
      'acme-menu',
      'acme-mockup-block',
      'acme-notice',
      'acme-notifications',
      'acme-overview',
      'acme-page-list',
      'acme-page-view',
      'acme-pager',
      'acme-popover',
      'acme-question-block',
      'acme-rich-input',
      'acme-section',
      'acme-select',
      'acme-separator',
      'acme-sheet',
      'acme-shell',
      'acme-skeleton',
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
    expect(components!.children.find((page) => page.kind === 'component')).toMatchObject({
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

  it('tells followers once a component edit settles, recompiles, and closes pages when they leave', async () => {
    const { pages, make, transport, open } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const button = config.components.find((entry) => entry.tag === 'button')!.page!;
    const source = pageDesignSystems(transport);
    const before = open.count;
    let changes = 0;
    const stop = source.watch(rootId, () => changes++);
    const first = await source.draft(rootId);
    expect(await source.draft(rootId)).toBe(first);
    const page = await transport.page(button);
    await page.binding!.edit(recolor(page.source), page.source);
    await page.binding!.edit(recolor(pages.get(button)!.source), pages.get(button)!.source);
    page.binding!.close();
    expect(changes).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, DRAFT_SETTLE_MS + 50));
    expect(changes).toBe(1);
    const second = await source.draft(rootId);
    expect(second.hash).not.toBe(first.hash);
    stop();
    expect(open.count).toBe(before);
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

describe('built-in tmt GUI pages (#5969)', () => {
  it('makes the tmt GUI as pages that follow tmt-gui, name their files and list as built-in', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const rootId = await syncBuiltInMirror(transport);
    const root = pages.get(rootId)!;
    expect(readBlock(root.source, 'origin')).toEqual({ key: '', bundle: await shippedBundle() });
    const { systems } = await listDesignSystems(transport);
    const entry = systems.find((system) => system.id === rootId)!;
    expect(entry.builtIn).toEqual({ bundle: await shippedBundle() });
    const button = entry.tree.children
      .find((node) => node.key === 'components')!
      .children.find((node) => node.key === 'components/button')!;
    const source = pages.get(button.id)!.source;
    expect(source).toContain('<meta name="tmt-ds" content="tmt-gui">');
    expect(source).toContain(GENERATED_NOTE);
    expect(readBlock<{ files: string[] }>(source, 'origin')!.files).toContain(
      'design/browser-ui/src/ui/button.tsx',
    );
    expect(source).toContain('data-ds-example="button:primary"');
    for (const id of [rootId, button.id]) expect(pages.get(id)!.projects).toEqual([DESIGN_PROJECT]);
  });

  it('regenerates in place: same ids, an owner edit replaced, a gone entry archived, nothing edited when current', async () => {
    const { pages, make, transport, open } = space();
    make('Notes');
    const rootId = await syncBuiltInMirror(transport);
    const tree = (await listDesignSystems(transport)).systems.find((s) => s.id === rootId)!.tree;
    const components = tree.children.find((node) => node.key === 'components')!;
    const button = components.children.find((node) => node.key === 'components/button')!;
    const generated = pages.get(button.id)!.source;
    const edits = open.edits;
    await syncBuiltInMirror(transport, rootId);
    expect(open.edits).toBe(edits);
    pages.get(button.id)!.source = `${generated}<p>Owner edit</p>`;
    // A page whose docs entry no longer exists, with its threads.
    const gone = make('Gone');
    pages.get(components.id)!.order.push(gone);
    pages.get(gone)!.source =
      '<script type="application/json" data-tmt-ds="origin">{"key":"components/gone"}</script>';
    await syncBuiltInMirror(transport, rootId);
    expect(pages.get(button.id)!.source).toBe(generated);
    expect(pages.get(gone)!.archived).toBe(true);
    expect(pages.has(gone)).toBe(true);
    const again = (await listDesignSystems(transport)).systems.find((s) => s.id === rootId)!.tree;
    expect(again.children.find((node) => node.key === 'components')!.id).toBe(components.id);
  });
  it('two syncs at once (two tabs or devices) end with one tree and one page per docs path', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const [first, second] = await Promise.all([
      syncBuiltInMirror(transport),
      syncBuiltInMirror(transport),
    ]);
    expect(second).toBe(first);
    const builtIn = (await listDesignSystems(transport)).systems.filter((system) => system.builtIn);
    expect(builtIn.map((system) => system.id)).toEqual([first]);
    // Each docs path has one live page, all in that tree; the other sync's pages are archived.
    const live = [...pages].filter(([, page]) => !page.archived);
    const keys = live.flatMap(([, page]) => {
      const origin = readBlock<{ key: string }>(page.source, 'origin');
      return origin ? [origin.key] : [];
    });
    expect(keys.length).toBeGreaterThan(3);
    expect(new Set(keys).size).toBe(keys.length);
    const inTree = new Set<string>();
    const walk = (node: { id: string; children: readonly unknown[] }) => {
      inTree.add(node.id);
      for (const child of node.children) walk(child as typeof node);
    };
    walk(builtIn[0]!.tree);
    for (const [id, page] of live)
      if (readBlock(page.source, 'origin')) expect(inTree.has(id), id).toBe(true);
    expect([...pages.values()].some((page) => page.archived)).toBe(true);
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
