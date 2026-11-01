import { describe, expect, it } from 'vite-plus/test';
import type { DesignSystemConfig } from '../../../../../design/systems/compiler.mjs';
import { bundleHash } from '../src/design-system.js';
import {
  createFromTemplate,
  nextVersion,
  pageDesignSystems,
  publishDesignSystem,
  readBlock,
  writeBlock,
  writePin,
} from '../src/design-system-pages.js';
import type { PageBinding, PageTransport } from '../src/transport.js';

/** #5821 / epic #5866: design systems as ordinary pages, over an in-memory space whose pages
 * hold source, sub-pages and attachments the way the live bindings do. */
function space() {
  const pages = new Map<
    string,
    { source: string; attachments: { id: string; bytes: Uint8Array }[] }
  >();
  let next = 0;
  const make = (title: string) => {
    const id = `page-${++next}`;
    pages.set(id, { source: `<h1>${title}</h1>`, attachments: [] });
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
        if (action !== 'subpage.create') throw new Error(action);
        return { childPage: make(String(body.title)) };
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
        source: page.source,
        binding: binding(id),
        attachments: page.attachments.map((entry) => ({ attachmentId: entry.id })),
      };
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
  it('copies the template under a page, publishes, pins every page and serves the bundle', async () => {
    const { pages, make, binding, transport } = space();
    const home = make('Home');
    const rootId = await createFromTemplate(transport, binding(home), 'Acme', 'acme');
    const root = pages.get(rootId)!;
    const config = readBlock<DesignSystemConfig>(root.source, 'design-system')!;
    expect(config).toMatchObject({ name: 'Acme', prefix: 'acme', id: rootId, version: '0.1.0' });
    expect(config.releases).toHaveLength(1);
    const [release] = config.releases;
    const pin = `${rootId}@0.1.0#${release!.bundle}`;
    expect(root.source).toContain(`<meta name="tmt-ds" content="${pin}">`);
    const button = pages.get(config.components[0]!.page!)!;
    expect(button.source).toContain(`content="${pin}"`);
    expect(button.source).toContain('<acme-button variant="outline">');
    expect(readBlock(button.source, 'component')).toMatchObject({ tag: 'button' });
    // The renderer reads the release attachment and the bundle verifies against its pin.
    const bundle = await pageDesignSystems(transport)({
      system: rootId,
      version: '0.1.0',
      hash: release!.bundle,
    });
    expect(bundle!.components.map((component) => component.tag)).toEqual(['acme-button']);
    expect(await bundleHash(bundle!)).toBe(release!.bundle);
    // A second publish adds a version and moves the pins.
    const second = await publishDesignSystem(
      transport,
      rootId,
      binding(rootId),
      root.source,
      '0.1.1',
    );
    expect(readBlock<DesignSystemConfig>(root.source, 'design-system')!.releases).toHaveLength(2);
    expect(button.source).toContain(second.pin);
  });

  it('refuses to publish when a component page lost its block', async () => {
    const { pages, make, binding, transport } = space();
    const rootId = await createFromTemplate(transport, binding(make('Home')), 'Acme', 'acme');
    const root = pages.get(rootId)!;
    const config = readBlock<DesignSystemConfig>(root.source, 'design-system')!;
    pages.get(config.components[0]!.page!)!.source = '<p>edited away</p>';
    await expect(
      publishDesignSystem(transport, rootId, binding(rootId), root.source, '0.1.1'),
    ).rejects.toThrow('has no component block');
  });
});
