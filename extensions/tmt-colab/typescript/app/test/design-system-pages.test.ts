import { describe, expect, it } from 'vite-plus/test';
import type { DesignSystemConfig } from '../../../../../design/systems/compiler.mjs';
import { bundleHash } from '../src/design-system.js';
import {
  adoptDesignSystem,
  createDesignSystem,
  DESIGN_PROJECT,
  listDesignSystems,
  nextVersion,
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
    }
  >();
  let next = 0;
  const make = (title: string) => {
    const id = `page-${++next}`;
    pages.set(id, { title, source: `<h1>${title}</h1>`, order: [], projects: [], attachments: [] });
    return id;
  };
  const binding = (id: string): PageBinding => {
    const page = () => pages.get(id)!;
    return {
      close: () => {},
      edit: async (source: string, base: string) => {
        if (base !== page().source) throw new Error('stale base');
        page().source = source;
        return { merged: false };
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
      })),
    }),
    management: {
      setProjects: async (changes: { pageId: string; projects: string[] }[]) => {
        // As the real client refuses: one request lists its pages in ID order.
        const order = changes.map((change) => change.pageId);
        if (order.join() !== [...order].sort().join())
          throw new Error('Invalid colab-v1 value or proof');
        for (const change of changes) pages.get(change.pageId)!.projects = [...change.projects];
      },
    },
  } as unknown as PageTransport;
  return { pages, make, binding, transport };
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
    const pin = `${rootId}@0.1.0#${release!.bundle}`;
    expect(root.source).toContain(`<meta name="tmt-ds" content="${pin}">`);
    const buttonId = config.components[0]!.page!;
    const button = pages.get(buttonId)!;
    expect(button.source).toContain(`content="${pin}"`);
    expect(button.source).toContain('<acme-button variant="outline">');
    expect(readBlock(button.source, 'component')).toMatchObject({ tag: 'button' });
    for (const id of [rootId, buttonId]) expect(pages.get(id)!.projects).toEqual([DESIGN_PROJECT]);
    // The renderer reads the release attachment and the bundle verifies against its pin.
    const bundle = await pageDesignSystems(transport)({
      system: rootId,
      version: '0.1.0',
      hash: release!.bundle,
    });
    expect(bundle!.components.map((component) => component.tag).sort()).toEqual([
      'acme-alert',
      'acme-badge',
      'acme-button',
      'acme-card',
      'acme-checkbox',
      'acme-empty',
      'acme-input',
      'acme-separator',
      'acme-skeleton',
      'acme-surface',
      'acme-switch',
      'acme-tabs',
      'acme-textarea',
    ]);
    expect(await bundleHash(bundle!)).toBe(release!.bundle);
    // Publish from the Design header adds a version and moves the pins.
    const second = await publishNext(transport, rootId);
    expect(second.version).toBe('0.1.1');
    expect(readBlock<DesignSystemConfig>(root.source, 'design-system')!.releases).toHaveLength(2);
    expect(button.source).toContain(second.pin);
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

  it('reports the pages a publish could not move to the new pin, and retries them', async () => {
    const { pages, make, transport } = space();
    make('Notes');
    const rootId = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
    const config = readBlock<DesignSystemConfig>(pages.get(rootId)!.source, 'design-system')!;
    const stuck = config.components[0]!.page!;
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
    expect(pages.get(stuck)!.source).not.toContain(result.pin);
    refuse = false;
    expect(await pinDesignTree(flaky, rootId, result.pin)).toEqual([]);
    expect(pages.get(stuck)!.source).toContain(result.pin);
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
        { title: 'Patterns', kind: 'page' },
      ],
    });
    const [foundations, components, patterns] = systems[0]!.tree.children;
    expect(foundations!.children.map((page) => page.title)).toContain('Colour');
    // Every page shows its title; a component page also names its tag.
    expect(components!.children.find((page) => page.kind === 'component')).toMatchObject({
      title: 'Button',
      tag: 'button',
    });
    expect(components!.children.length).toBeGreaterThan(20);
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
