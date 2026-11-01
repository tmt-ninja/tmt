import type { attachment } from '@tmt/colab-client';
import {
  buildBundle,
  type Bundle,
  type ComponentDoc,
  type DesignSystemConfig,
} from '../../../../../design/systems/compiler.mjs';
import template from '../../../../../design/systems/tmt-gui/generated/template.json';
import type { DesignSystemBundle, DesignSystemSource } from './design-system.js';
import type { PageBinding, PageSnapshot, PageTransport } from './transport.js';

/*
 * Design systems as ordinary pages (#5821, epic #5866): the root page holds the
 * DesignSystemConfig and each component page its definition, in a JSON data block; the page body
 * is the docs. A release is an ordinary attachment of the root page. Nothing here needs a new
 * record kind or serve route.
 */

export type BlockKind = 'design-system' | 'component';
const blockPattern = (kind: BlockKind) =>
  new RegExp(
    `<script type="application/json" data-tmt-ds="${kind}">([\\s\\S]*?)</script>`,
    'i',
  );
/** The page's data block of one kind, parsed, or undefined. */
export function readBlock<T>(source: string, kind: BlockKind): T | undefined {
  const match = blockPattern(kind).exec(source);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]!) as T;
  } catch {
    return undefined;
  }
}
/** JSON that cannot end its script element or open a comment. */
const blockJson = (value: unknown) =>
  JSON.stringify(value, null, 1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
export const blockHtml = (kind: BlockKind, value: unknown) =>
  `<script type="application/json" data-tmt-ds="${kind}">${blockJson(value)}</script>`;
/** The source with its block of this kind replaced (or prepended when it has none). */
export function writeBlock(source: string, kind: BlockKind, value: unknown): string {
  const html = blockHtml(kind, value);
  return blockPattern(kind).test(source)
    ? source.replace(blockPattern(kind), () => html)
    : `${html}\n${source}`;
}
/** The pin `<meta name="tmt-ds">` a page carries, replaced or added. */
export function writePin(source: string, pin: string): string {
  const meta = `<meta name="tmt-ds" content="${pin}">`;
  const pattern = /<meta name="tmt-ds" content="[^"]*">/i;
  return pattern.test(source) ? source.replace(pattern, meta) : `${meta}\n${source}`;
}

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

type Snapshot = PageSnapshot & { attachments?: readonly attachment.AttachmentDescriptor[] };
/** Open another page, use it, and always close its binding. */
async function withPage<T>(
  transport: PageTransport,
  id: string,
  use: (page: Snapshot) => Promise<T>,
): Promise<T> {
  const page = (await transport.page(id)) as Snapshot;
  try {
    return await use(page);
  } finally {
    page.binding?.close();
  }
}
/** The page's binding once it can read attachments: the discussion must verify first. */
async function readyFiles(page: Snapshot) {
  const files = page.binding?.files;
  if (!files) throw new Error('This page cannot read its files here.');
  await files.attachments.settle?.();
  return files;
}

/** Bundles read from a root page's release attachment, cached by hash for the session. */
const bundles = new Map<string, Promise<DesignSystemBundle | undefined>>();
/** Where the renderer reads a pinned bundle: the system root page's release of that version. */
export function pageDesignSystems(transport: PageTransport): DesignSystemSource {
  return (pin) => {
    let bundle = bundles.get(pin.hash);
    if (!bundle) {
      bundle = withPage(transport, pin.system, async (root) => {
        const config = readBlock<DesignSystemConfig>(root.source, 'design-system');
        const release = config?.releases.find(
          (entry) => entry.version === pin.version && entry.bundle === pin.hash,
        );
        const descriptor = root.attachments?.find(
          (entry) => entry.attachmentId === release?.attachment,
        );
        if (!descriptor) return undefined;
        const files = await readyFiles(root);
        const bytes = await files.attachments.open({ kind: 'document' }, descriptor);
        return JSON.parse(new TextDecoder().decode(bytes)) as DesignSystemBundle;
      });
      bundle.then((value) => value ?? bundles.delete(pin.hash)).catch(() => bundles.delete(pin.hash));
      bundles.set(pin.hash, bundle);
    }
    return bundle;
  };
}

/** The next patch version after the latest release, or the config's own version for the first. */
export function nextVersion(config: DesignSystemConfig): string {
  const latest = config.releases.at(-1)?.version;
  if (!latest) return config.version;
  const [major, minor, patch] = latest.split('.').map(Number);
  return `${major}.${minor}.${patch! + 1}`;
}

export interface PublishResult {
  pin: string;
  bundle: Bundle;
}
/**
 * Publish a version from the open root page: compile its component pages, attach the bundle to the
 * root page, record the release in its config and move every component page's pin to it.
 */
export async function publishDesignSystem(
  transport: PageTransport,
  rootId: string,
  binding: PageBinding,
  source: string,
  version: string,
): Promise<PublishResult> {
  const config = readBlock<DesignSystemConfig>(source, 'design-system');
  if (!config) throw new Error('This page has no design-system block.');
  const components: ComponentDoc[] = [];
  for (const entry of config.components) {
    if (!entry.page) throw new Error(`${entry.tag} has no page.`);
    const doc = await withPage(transport, entry.page, async (page) =>
      readBlock<ComponentDoc>(page.source, 'component'),
    );
    if (!doc) throw new Error(`The ${entry.tag} page has no component block.`);
    components.push(doc);
  }
  const bundle = await buildBundle(rootId, { ...config, version }, components, sha256Hex);
  const files = binding.files;
  if (!files) throw new Error('Files are not available on this page.');
  const stored = await files.attachments.upload(
    {
      filename: `${config.prefix}-${version}.json`,
      mediaType: 'application/json',
      bytes: new TextEncoder().encode(JSON.stringify(bundle)),
    },
    files.target(),
    () => {},
  );
  await files.add([stored]);
  const pin = `${rootId}@${version}#${bundle.hash}`;
  const next = {
    ...config,
    version,
    releases: [
      ...config.releases,
      {
        version,
        bundle: bundle.hash,
        attachment: stored.original.descriptor.attachmentId,
        runtime: bundle.runtime,
        at: new Date().toISOString(),
      },
    ],
  };
  // The attachment edit kept the source; the config and the home page's pin change now.
  await binding.edit(writePin(writeBlock(source, 'design-system', next), pin), source);
  for (const entry of config.components)
    await withPage(transport, entry.page!, async (page) => {
      if (page.binding) await page.binding.edit(writePin(page.source, pin), page.source);
    });
  return { pin, bundle };
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A component page: its block, then its docs: notes, the props table and the live examples. */
export function componentPageSource(doc: ComponentDoc & { notes?: string }, prefix: string) {
  const tag = `${prefix}-${doc.tag}`;
  const rows = Object.entries(doc.props)
    .map(
      ([name, spec]) =>
        `<tr><td><code>${escape(name)}</code></td><td>${escape(spec.enum ? spec.enum.join(' · ') : (spec.type ?? ''))}</td><td>${escape(spec.default ?? '')}</td></tr>`,
    )
    .join('');
  const examples = (doc.examples ?? [])
    .map(
      (example) =>
        `<section class="tmt-ui-section"><h3>${escape(example.title)}</h3><div data-ds-example>${example.markup.replaceAll('tmt-ui-', `${prefix}-`)}</div><pre><code>${escape(example.markup.replaceAll('tmt-ui-', `${prefix}-`))}</code></pre></section>`,
    )
    .join('\n');
  return `${blockHtml('component', doc)}
<h1>&lt;${tag}&gt;</h1>
${doc.notes ?? ''}
<h2>Props</h2>
<table class="tmt-ui-table"><thead><tr><th>Prop</th><th>Values</th><th>Default</th></tr></thead><tbody>${rows}</tbody></table>
<p>Slots: ${doc.slots.map((slot) => `<code>${escape(slot)}</code>`).join(', ')}</p>
<h2>Examples</h2>
${examples}`;
}

/** The root page: its config block, then the system's home. */
export function rootPageSource(config: DesignSystemConfig) {
  return `${blockHtml('design-system', config)}
<h1>${escape(config.name)}</h1>
<p>${escape(config.principles?.summary ?? '')}</p>
<p>Tag prefix <code>${escape(config.prefix)}-</code> · runtime ${escape(config.runtime)}</p>
<h2>Components</h2>
<ul>${config.components.map((entry) => `<li><code>&lt;${escape(config.prefix)}-${escape(entry.tag)}&gt;</code> · ${escape(entry.status ?? '')}</li>`).join('')}</ul>
<p>Publish a version from this page to pin it on other pages.</p>`;
}

/**
 * Copy the TMT template into the space under the open page: a root page with its own name and
 * prefix, a page per component, then publish the first version so every page draws.
 */
export async function createFromTemplate(
  transport: PageTransport,
  parent: PageBinding,
  name: string,
  prefix: string,
): Promise<string> {
  const { system, components } = template as unknown as {
    system: DesignSystemConfig;
    components: (ComponentDoc & { notes?: string })[];
  };
  if (!parent.work) throw new Error('Sub-pages cannot be made here.');
  const created = await parent.work('subpage.create', { title: name });
  const rootId = created.childPage;
  if (!rootId) throw new Error('The design system page was not made.');
  const entries: DesignSystemConfig['components'] = [];
  await withPage(transport, rootId, async (root) => {
    if (!root.binding?.work) throw new Error('The design system page cannot hold sub-pages.');
    for (const doc of components) {
      const child = await root.binding.work('subpage.create', { title: `${prefix}-${doc.tag}` });
      if (!child.childPage) throw new Error(`The ${doc.tag} page was not made.`);
      await withPage(transport, child.childPage, async (page) => {
        await page.binding!.edit(componentPageSource(doc, prefix), page.source);
      });
      entries.push({ page: child.childPage, tag: doc.tag, status: 'stable' });
    }
    const config: DesignSystemConfig = {
      ...system,
      id: rootId,
      name,
      prefix,
      components: entries,
      releases: [],
    };
    await root.binding.edit(rootPageSource(config), root.source);
  });
  await withPage(transport, rootId, async (root) => {
    const config = readBlock<DesignSystemConfig>(root.source, 'design-system')!;
    await publishDesignSystem(transport, rootId, root.binding!, root.source, nextVersion(config));
  });
  return rootId;
}
