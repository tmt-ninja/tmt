import type { attachment } from '@tmt/colab-client';
import {
  buildBundle,
  type Bundle,
  type ComponentDoc,
  type DesignSystemConfig,
} from '../../../../../design/systems/compiler.mjs';
import {
  DesignDraftError,
  type DesignSystemBundle,
  type DesignSystemLock,
  type DesignSystemSource,
} from './design-system.js';
import type {
  PageBinding,
  PageSnapshot,
  PageSummary,
  PageTransport,
  SpaceHome,
} from './transport.js';
import { DESIGN_SYSTEM_PROJECT } from './projects.js';
import { subpages } from './work.js';
import { PROJECT_REQUEST_PAGES } from './projects.js';

/*
 * Design systems as ordinary pages (#5821, epic #5866): the root page holds the
 * DesignSystemConfig and each component page its definition, in a JSON data block whose
 * `data-tmt-ds` names the page's kind; the page body is the docs. A release is an ordinary
 * attachment of the root page. Nothing here needs a new record kind or serve route.
 *
 * Each system is its own top-level page tree that the Design tab shows: its root is made under
 * another page and detached at once. Every page of it holds the reserved, never-shown owner-store
 * project `tmt:design-system` (colab-v1: Projects), which is how the Colab list, the Design tab and
 * `tmt colab design` all find design-system pages without reading sources.
 */

/** `annotates` marks the page that holds a built-in tmt GUI page's discussion (design-built-in.ts). */
export type BlockKind = 'design-system' | 'component' | 'annotates';
/** The reserved owner-store project every design-system page holds (contract: Projects). */
export const DESIGN_PROJECT = DESIGN_SYSTEM_PROJECT;
export const isDesignSystemPage = (page: Pick<PageSummary, 'projects'>) =>
  !!page.projects?.includes(DESIGN_PROJECT);
/** The space as Colab lists it: design-system pages and their project belong to the Design tab. */
export function withoutDesignSystems(home: SpaceHome): SpaceHome {
  if (!home.pages.some(isDesignSystemPage) && !home.projects?.includes(DESIGN_PROJECT)) return home;
  const hidden = new Set(home.pages.filter(isDesignSystemPage).map((page) => page.id));
  return {
    ...home,
    pages: home.pages.filter((page) => !hidden.has(page.id)),
    ...(home.pageIds && { pageIds: home.pageIds.filter((row) => !hidden.has(row.pageId)) }),
    ...(home.projects && { projects: home.projects.filter((name) => name !== DESIGN_PROJECT) }),
    ...(home.projectPins && {
      projectPins: {
        ...home.projectPins,
        names: home.projectPins.names.filter((name) => name !== DESIGN_PROJECT),
      },
    }),
  };
}
const blockPattern = (kind: BlockKind) =>
  new RegExp(`<script type="application/json" data-tmt-ds="${kind}">([\\s\\S]*?)</script>`, 'i');
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

export type Snapshot = PageSnapshot & { attachments?: readonly attachment.AttachmentDescriptor[] };
/** Open another page, use it, and always close its binding. */
export async function withPage<T>(
  transport: PageTransport,
  id: string,
  use: (page: Snapshot) => Promise<T>,
): Promise<T> {
  // A page made a moment ago may not be listed yet: try again briefly before giving up.
  let page: Snapshot | undefined;
  for (let attempt = 0; !page; attempt++) {
    try {
      page = (await transport.page(id)) as Snapshot;
    } catch (error) {
      if (attempt >= 10) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
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

/** The built-in system's ID in a pin: `tmt-gui`, no page behind it. */
export const BUILT_IN_SYSTEM = 'tmt-gui';
/** The built-in tmt GUI release ships with the app: every install can use it (#5921). Its draft is
 * that release: it has no pages to edit. */
const builtIn = () =>
  import('../../../../../design/systems/tmt-gui/generated/bundle.json').then(
    ({ default: bundle }) => bundle as unknown as DesignSystemBundle,
  );
/** How long a burst of edits to a system's pages settles before its followers redraw. */
export const DRAFT_SETTLE_MS = 500;

/** One followed system: its open page subscriptions and the draft compiled since the last edit. */
interface Follow {
  readonly listeners: Set<() => void>;
  readonly stops: Map<string, () => void>;
  readonly seen: Map<string, string>;
  timer?: ReturnType<typeof setTimeout>;
  draft?: Promise<DesignSystemBundle>;
  /** Its last follower left: a page still opening closes again. */
  stopped?: boolean;
}

/**
 * Where the renderer reads a page's bundle (design-system.ts verifies a locked one): a locked
 * release is the root page's release attachment of that version; a live pin is the draft, compiled
 * from the root and component pages as publish compiles them. While a page follows a system, its
 * root and component pages stay subscribed, the compiled draft is kept until one of them changes,
 * and followers hear of a change once the edits settle. `shown` lets the Design header show a
 * release in place of the draft.
 */
export function pageDesignSystems(
  transport: PageTransport,
  shown?: (system: string) => string | undefined,
): DesignSystemSource {
  const follows = new Map<string, Follow>();
  const release = (system: string, lock: DesignSystemLock) =>
    system === BUILT_IN_SYSTEM
      ? builtIn()
      : withPage(transport, system, async (root) => {
          const config = readBlock<DesignSystemConfig>(root.source, 'design-system');
          const entry = config?.releases.find(
            (item) => item.version === lock.version && item.bundle === lock.hash,
          );
          const descriptor = root.attachments?.find(
            (item) => item.attachmentId === entry?.attachment,
          );
          if (!descriptor) return undefined;
          const files = await readyFiles(root);
          const bytes = await files.attachments.open({ kind: 'document' }, descriptor);
          return JSON.parse(new TextDecoder().decode(bytes)) as DesignSystemBundle;
        });
  const shownRelease = async (system: string, version: string) => {
    const hash = await withPage(transport, system, async (root) =>
      readBlock<DesignSystemConfig>(root.source, 'design-system')?.releases.find(
        (item) => item.version === version,
      ),
    );
    const bundle = hash && (await release(system, { version, hash: hash.bundle }));
    if (!bundle) throw new DesignDraftError(`Release ${version} cannot be read.`);
    return bundle;
  };
  const notify = (follow: Follow) => {
    follow.draft = undefined;
    clearTimeout(follow.timer);
    follow.timer = setTimeout(() => {
      for (const listener of follow.listeners) listener();
    }, DRAFT_SETTLE_MS);
  };
  // Open one page of the followed system and keep it subscribed; the root's view also names the
  // component pages, which are opened the same way.
  const track = async (follow: Follow, id: string, root: boolean): Promise<void> => {
    if (follow.stops.has(id)) return;
    follow.stops.set(id, () => {});
    const page = await transport.page(id).catch(() => undefined);
    if (!page?.binding) return;
    if (follow.stopped) {
      page.binding.close();
      return;
    }
    const binding = page.binding;
    const seen = (source: string) => {
      const before = follow.seen.get(id);
      follow.seen.set(id, source);
      if (before !== undefined && before !== source) notify(follow);
      if (root)
        for (const entry of readBlock<DesignSystemConfig>(source, 'design-system')?.components ??
          [])
          if (entry.page) void track(follow, entry.page, false);
    };
    seen(page.source);
    const unsubscribe = binding.subscribe(
      (view) => seen(view.source),
      () => {},
    );
    follow.stops.set(id, () => {
      unsubscribe();
      binding.close();
    });
  };
  return {
    release,
    draft(system) {
      const version = shown?.(system);
      if (system === BUILT_IN_SYSTEM) return builtIn();
      if (version) return shownRelease(system, version);
      const follow = follows.get(system);
      if (!follow) return compileDraft(transport, system);
      return (follow.draft ??= compileDraft(transport, system).catch((error: unknown) => {
        follow.draft = undefined;
        throw error;
      }));
    },
    watch(system, changed) {
      if (system === BUILT_IN_SYSTEM) return () => {};
      let follow = follows.get(system);
      if (!follow) {
        follow = { listeners: new Set(), stops: new Map(), seen: new Map() };
        follows.set(system, follow);
        void track(follow, system, true);
      }
      const active = follow;
      active.listeners.add(changed);
      return () => {
        active.listeners.delete(changed);
        if (active.listeners.size) return;
        clearTimeout(active.timer);
        active.stopped = true;
        for (const stop of active.stops.values()) stop();
        follows.delete(system);
      };
    },
  };
}

/** The draft as publish compiles it: the root's config and each component page's block, at the
 * version the next publish makes. Throws `DesignDraftError` naming what is broken. */
export async function compileDraft(
  transport: PageTransport,
  rootId: string,
  version?: string,
): Promise<DesignSystemBundle> {
  const config = await withPage(transport, rootId, async (root) =>
    readBlock<DesignSystemConfig>(root.source, 'design-system'),
  );
  if (!config) throw new DesignDraftError('The design system page has no design-system block.');
  return draftOf(transport, rootId, config, version ?? nextVersion(config));
}
async function draftOf(
  transport: PageTransport,
  rootId: string,
  config: DesignSystemConfig,
  version: string,
): Promise<Bundle> {
  const components: ComponentDoc[] = [];
  for (const entry of config.components) {
    if (!entry.page) throw new DesignDraftError(`${entry.tag} has no page.`);
    const doc = await withPage(transport, entry.page, async (page) => {
      const block = readBlock<ComponentDoc>(page.source, 'component');
      return block && { ...block, examples: pageExamples(page.source) };
    });
    if (!doc) throw new DesignDraftError(`The ${entry.tag} page has no component block.`);
    components.push(doc);
  }
  try {
    return await buildBundle(rootId, { ...config, version }, components, sha256Hex);
  } catch (error) {
    throw new DesignDraftError(error instanceof Error ? error.message : String(error));
  }
}

/** The next patch version after the latest release, or the config's own version for the first. */
export function nextVersion(config: DesignSystemConfig): string {
  const latest = config.releases.at(-1)?.version;
  if (!latest) return config.version;
  const [major, minor, patch] = latest.split('.').map(Number);
  return `${major}.${minor}.${patch! + 1}`;
}

/** A component page's examples as its HTML holds them (their one place): each title and the markup
 * its snippet shows. */
export function pageExamples(source: string): { title: string; markup: string }[] {
  const example =
    /<h3>([\s\S]*?)<\/h3>\s*<div [^>]*data-ds-example="[^"]*"[^>]*>[\s\S]*?<div class="docs-snippet"><pre><code>([\s\S]*?)<\/code><\/pre>/g;
  const text = (html: string) =>
    html
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .trim();
  return [...source.matchAll(example)].map((match) => ({
    title: text(match[1]!),
    markup: text(match[2]!),
  }));
}

export interface PublishResult {
  pin: string;
  bundle: Bundle;
  /** Pages of the tree that do not follow the draft yet; `pinDesignTree` retries them. */
  unpinned: string[];
}
/** Make every page of a system's tree (but its root, which publish pins itself) follow its draft;
 * a page already following it is not edited. A page that cannot be opened or edited is reported,
 * not fatal: the release is already recorded. */
export async function pinDesignTree(transport: PageTransport, rootId: string): Promise<string[]> {
  const unpinned: string[] = [];
  const visit = async (id: string, depth: number): Promise<void> => {
    let children: string[] = [];
    try {
      children = await withPage(transport, id, async (page) => {
        try {
          const followed = writePin(page.source, rootId);
          if (id !== rootId && page.binding && followed !== page.source)
            await page.binding.edit(followed, page.source);
        } catch {
          unpinned.push(page.title);
        }
        return depth >= TREE_DEPTH ? [] : subpages(page.work);
      });
    } catch {
      unpinned.push(id);
    }
    for (const child of children) await visit(child, depth + 1);
  };
  await visit(rootId, 0);
  return unpinned;
}
/**
 * Publish a version from the open root page: compile its component pages as the draft compiles,
 * attach the bundle to the root page and record the release in its config. Pages lock to it with
 * the returned pin; the system's own tree keeps following the draft.
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
  const bundle = await draftOf(transport, rootId, config, version);
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
  // The attachment edit kept the source; the config records the release. The tree follows the
  // draft, so a release changes no page's look: it is what a page can lock to.
  await binding.edit(writePin(writeBlock(source, 'design-system', next), rootId), source);
  // A tree made before its pages followed the draft (or a page whose pin was edited) moves to it:
  // the components, the doc pages (they take its CSS) and the section pages.
  return { pin, bundle, unpinned: await pinDesignTree(transport, rootId) };
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Each example's id within its component: its title as lowercase words joined by hyphens, numbered
 * when two titles meet. A Design point-and-fix anchor names `<component>:<id>` (#5866). */
export function exampleIds<T extends { title: string }>(examples: readonly T[]) {
  const seen = new Map<string, number>();
  return examples.map((example) => {
    const base =
      example.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'example';
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { id: count === 1 ? base : `${base}-${count}`, example };
  });
}

/** A design-system page pins its system, so the frame loads the page runtime, whose Tailwind reset
 * sits above the editorial layer: the docs set their own text with the runtime's utilities. */
const docs = {
  h1: 'text-3xl font-semibold mt-6 mb-3',
  h2: 'text-xl font-semibold mt-10 mb-3',
  block: 'my-3',
  code: 'font-mono text-sm',
  link: 'text-link underline',
  label: 'font-mono text-xs text-secondary mb-2',
};

/** A component page: its block (what publish compiles), then its docs in the tmt GUI docs' own
 * component layout (the system CSS carries their scoped styles): notes, the live examples and the
 * props table. */
export function componentPageSource(
  doc: ComponentDoc & { notes?: string },
  prefix: string,
  presentation?: {
    title: string;
    description?: string;
    usage?: string;
    dos?: readonly (readonly [string, string])[];
  },
) {
  const tag = `${prefix}-${doc.tag}`;
  const rows = Object.entries(doc.props)
    .map(
      ([name, spec]) =>
        `<tr><td><code>${escape(name)}</code></td><td>${escape(spec.enum ? spec.enum.join(' · ') : (spec.type ?? ''))}</td><td>${escape(spec.default ?? '')}</td></tr>`,
    )
    .join('');
  const examples = exampleIds(doc.examples ?? []).map(({ id, example }) => {
    const markup = example.markup.replaceAll('tmt-ui-', `${prefix}-`);
    // The example root holds its label, the live elements and their markup: a comment anywhere in
    // it quotes all three, and the label keeps the quote unique when two examples share markup. Its
    // id is the anchor a point-and-fix link opens the page at.
    const anchor = escape(`${doc.tag}:${id}`);
    return { title: example.title, anchor, markup };
  });
  const drawExample = ({ title, anchor, markup }: (typeof examples)[number], hero = false) =>
    `<section class="docs-variant${hero ? ' docs-hero' : ''}"><h3>${escape(title)}</h3><div id="${anchor}" data-ds-example="${anchor}"><p class="${docs.label} ds-example-label">${anchor}</p><div class="docs-canvas${hero ? ' docs-canvas-hero' : ''}"><div class="docs-scene">${markup}</div></div><div class="docs-snippet"><pre><code>${escape(markup)}</code></pre></div></div></section>`;
  const [hero, ...variants] = examples;
  // The block keeps what publish compiles; the notes and examples live only in the HTML below, so an
  // agent's patch of an example has one place to change.
  const { notes: _notes, examples: _examples, ...compiled } = doc;
  return `${blockHtml('component', compiled)}
<div class="tmt-design-docs"><article class="docs-article">
<h1>${presentation ? escape(presentation.title) : `&lt;${tag}&gt;`}</h1>
${presentation?.description ? `<p class="docs-lead">${escape(presentation.description)}</p>` : ''}
${hero ? drawExample(hero, true) : ''}
${presentation?.usage && hero ? `<h2>Usage</h2><div class="docs-snippet"><pre><code>${escape(hero.markup)}</code></pre></div>` : ''}
<h2>Variants and states</h2>
${variants.map((example) => drawExample(example)).join('\n')}
<h2>Props</h2>
<table class="docs-props"><thead><tr><th scope="col">Prop</th><th scope="col">Values</th><th scope="col">Default</th></tr></thead><tbody>${rows}</tbody></table>
<p>Slots: ${doc.slots.map((slot) => `<code>${escape(slot)}</code>`).join(', ')}</p>
${presentation?.dos?.length ? `<h2>Do and don't</h2><div class="docs-dos">${presentation.dos.map(([kind, text]) => `<div class="docs-do" data-kind="${escape(kind)}"><b>${kind === 'do' ? 'Do' : 'Don’t'}</b><p>${escape(text)}</p></div>`).join('')}</div>` : ''}
<div>${doc.notes ?? ''}</div>
</article></div>`;
}

/** The root page: its config block, then the system's home. */
export function rootPageSource(config: DesignSystemConfig) {
  const component = (entry: DesignSystemConfig['components'][number]) => {
    const name = `<code class="${docs.code}">&lt;${escape(config.prefix)}-${escape(entry.tag)}&gt;</code>`;
    return `<li>${entry.page ? `<a class="${docs.link}" href="/p/${escape(entry.page)}">${name}</a>` : name} · ${escape(entry.status ?? '')}</li>`;
  };
  return `${blockHtml('design-system', config)}
<h1 class="${docs.h1}">${escape(config.name)}</h1>
<p class="${docs.block}">${escape(config.principles?.summary ?? '')}</p>
<p class="${docs.block}">Tag prefix <code class="${docs.code}">${escape(config.prefix)}-</code> · runtime ${escape(config.runtime)}</p>
<h2 class="${docs.h2}">Components</h2>
<ul class="list-disc pl-6 space-y-1">${config.components.map(component).join('')}</ul>
<p class="${docs.block}">Pages that name this system follow its draft. Publish a version to give pages a release they can lock to.</p>`;
}

/** One section of the tmt GUI docs a new system copies: its title and its static doc pages. */
interface DocSection {
  title: string;
  pages: {
    slug: string;
    title: string;
    html: string;
    description?: string;
    usage?: string;
    dos?: [string, string][];
  }[];
}

/** A section page: its title and a link to each of its pages. */
export const sectionSource = (title: string, pages: readonly { id: string; title: string }[]) =>
  `<h1>${escape(title)}</h1>\n<ul>${pages.map((page) => `<li><a href="/p/${escape(page.id)}">${escape(page.title)}</a></li>`).join('')}</ul>`;

/**
 * Fill a new root page from the TMT template (#5866): the tmt GUI docs as section pages
 * (Foundations, Components, Patterns) with a page each, every component the template carries as
 * a live component page in Components, the root's config with its own name and prefix, then
 * publish the first version so every page draws. The template is loaded only here.
 */
async function fillFromTemplate(
  transport: PageTransport,
  rootId: string,
  name: string,
  prefix: string,
): Promise<void> {
  const [{ default: template }, { default: sections }] = await Promise.all([
    import('../../../../../design/systems/tmt-gui/generated/template.json'),
    import('../../../../../design/systems/tmt-gui/generated/pages.json'),
  ]);
  const { system, components } = template as unknown as {
    system: DesignSystemConfig;
    components: (ComponentDoc & { notes?: string })[];
  };
  const live = new Map(components.map((doc) => [doc.tag, doc]));
  const entries: DesignSystemConfig['components'] = [];
  let foundationPage: string | undefined;
  let patternPage: string | undefined;
  await withPage(transport, rootId, async (root) => {
    if (!root.binding?.work) throw new Error('The design system page cannot hold sub-pages.');
    const make = async (parent: Snapshot, title: string, source: string) => {
      const child = await parent.binding!.work!('subpage.create', { title });
      if (!child.childPage) throw new Error(`The ${title} page was not made.`);
      await withPage(transport, child.childPage, async (page) => {
        await page.binding!.edit(source, page.source);
      });
      return child.childPage;
    };
    for (const section of sections as DocSection[]) {
      const sectionId = await make(root, section.title, sectionSource(section.title, []));
      const made: { id: string; title: string }[] = [];
      await withPage(transport, sectionId, async (sectionPage) => {
        for (const doc of section.pages) {
          const component = ['Components', 'Browser components'].includes(section.title)
            ? live.get(doc.slug)
            : undefined;
          let body = component ? componentPageSource(component, prefix, doc) : doc.html;
          if (section.title === 'Foundations') {
            body = body.replaceAll('tmt-ui-foundation', `${prefix}-foundation`);
            if (doc.slug === 'colour') {
              const foundation = live.get('foundation');
              if (!foundation) throw new Error('The template has no foundation component.');
              const { notes: _notes, examples: _examples, ...compiled } = foundation;
              // The colour page owns the shared component in a copied system. Its hidden example
              // lets publishing retain a usable sample while the visible page stays the live doc.
              const markup = `<${prefix}-foundation page="colour"></${prefix}-foundation>`;
              body = `${blockHtml('component', compiled)}\n${body}\n<section hidden><h3>Colour</h3><div data-ds-example="foundation:colour"><div class="docs-snippet"><pre><code>${escape(markup)}</code></pre></div></div></section>`;
            }
          }
          if (section.title === 'Patterns') {
            body = body.replaceAll('tmt-ui-pattern', `${prefix}-pattern`);
            if (doc.slug === 'tabs-row') {
              const pattern = live.get('pattern');
              if (!pattern) throw new Error('The template has no pattern component.');
              const { notes: _notes, examples: _examples, ...compiled } = pattern;
              const markup = `<${prefix}-pattern page="tabs-row"></${prefix}-pattern>`;
              body = `${blockHtml('component', compiled)}\n${body}\n<section hidden><h3>Tabs row</h3><div data-ds-example="pattern:tabs-row"><div class="docs-snippet"><pre><code>${escape(markup)}</code></pre></div></div></section>`;
            }
          }
          const id = await make(sectionPage, doc.title, body);
          if (section.title === 'Foundations' && doc.slug === 'colour') foundationPage = id;
          if (section.title === 'Patterns' && doc.slug === 'tabs-row') patternPage = id;
          if (component) entries.push({ page: id, tag: component.tag, status: 'stable' });
          made.push({ id, title: doc.title });
        }
      });
      await withPage(transport, sectionId, async (sectionPage) => {
        await sectionPage.binding!.edit(sectionSource(section.title, made), sectionPage.source);
      });
    }
    if (!foundationPage) throw new Error('The template has no colour foundation page.');
    entries.push({ page: foundationPage, tag: 'foundation', status: 'stable' });
    if (!patternPage) throw new Error('The template has no tabs pattern page.');
    entries.push({ page: patternPage, tag: 'pattern', status: 'stable' });
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
}

/** The root page of a new system, top level: made under an existing system (or the first page) and
 * detached from it at once. */
export async function newRoot(transport: PageTransport, name: string): Promise<string> {
  const home = await transport.spaceHome();
  const live = home.pages.filter((page) => !page.archived);
  const parent = live.find(isDesignSystemPage) ?? live[0];
  if (!parent) throw new Error('Make a page first: the space has none to start from.');
  return withPage(transport, parent.id, async (page) => {
    if (!page.binding?.work) throw new Error('Pages cannot be made here.');
    const created = await page.binding.work('subpage.create', { title: name });
    if (!created.childPage) throw new Error('The design system page was not made.');
    await page.binding.work('subpage.detach', { pageId: created.childPage });
    return created.childPage;
  });
}

/** One page of a system's tree, as the Design tab's left nav lists it. */
export interface DesignTreeNode {
  id: string;
  title: string;
  /** The page's data-block kind; `page` for a docs page with no block; `section` for a built-in
   * heading that groups pages and is not a page itself. */
  kind: BlockKind | 'page' | 'section';
  /** A component page's tag without the system prefix, shown beside its title. */
  tag?: string;
  /** A built-in tree page's docs path (`components/button`; the root is ''). */
  key?: string;
  children: DesignTreeNode[];
}
/** A design system as the Design tab's switcher and header show it. */
export interface DesignSystemEntry {
  id: string;
  name: string;
  prefix: string;
  /** The latest published version; absent before the first publish. */
  version?: string;
  /** The version the next Publish makes. */
  next: string;
  config: DesignSystemConfig;
  /** The root page and the pages under it, in the root's sub-page order. */
  tree: DesignTreeNode;
  /** The built-in tmt GUI, drawn from what this build ships (design-built-in.ts). */
  builtIn?: true;
}
const TREE_DEPTH = 4;
async function treeOf(
  transport: PageTransport,
  page: Snapshot,
  titles: ReadonlyMap<string, string>,
  depth: number,
  archived: ReadonlySet<string> = new Set(),
): Promise<DesignTreeNode> {
  const component = readBlock<ComponentDoc>(page.source, 'component');
  const kind: DesignTreeNode['kind'] = readBlock(page.source, 'design-system')
    ? 'design-system'
    : component
      ? 'component'
      : 'page';
  // One page at a time, like publish: a new system's ~50 pages opened at once trip the sync
  // server's capacity limits (503/429).
  const children: DesignTreeNode[] = [];
  if (depth < TREE_DEPTH)
    for (const child of subpages(page.work))
      if (!archived.has(child))
        children.push(
          await withPage(transport, child, (sub) =>
            treeOf(transport, sub, titles, depth + 1, archived),
          ),
        );
  return {
    id: page.id,
    title: titles.get(page.id) ?? page.title,
    kind,
    ...(component?.tag && { tag: component.tag }),
    children,
  };
}
function entryOf(id: string, config: DesignSystemConfig, tree: DesignTreeNode): DesignSystemEntry {
  return {
    id,
    name: config.name,
    prefix: config.prefix,
    ...(config.releases.at(-1) && { version: config.releases.at(-1)!.version }),
    next: nextVersion(config),
    config,
    tree,
  };
}

export interface DesignSystemList {
  systems: DesignSystemEntry[];
  /** Titles of design-system pages that could not be read, so a system is never silently missing. */
  unreadable: string[];
}
/** The space's design systems: the design-system pages whose block is a config. Every page of a
 * tree holds the project, so pages are opened one at a time and a page already read as part of a
 * found tree is never opened again as a candidate root (a burst of opens is what a serve throttles). */
export async function listDesignSystems(
  transport: PageTransport,
  signal?: AbortSignal,
): Promise<DesignSystemList> {
  const home = await transport.spaceHome(signal);
  const titles = new Map(home.pages.map((page) => [page.id, page.title]));
  // An archived page (a built-in page whose docs entry is gone, say) keeps its threads but leaves
  // the tree.
  const archived = new Set(home.pages.filter((page) => page.archived).map((page) => page.id));
  const seen = new Set<string>();
  const systems: DesignSystemEntry[] = [];
  const failed: { id: string; title: string }[] = [];
  for (const page of home.pages.filter((page) => isDesignSystemPage(page) && !page.archived)) {
    signal?.throwIfAborted();
    if (seen.has(page.id)) continue;
    try {
      const entry = await withPage(transport, page.id, async (root) => {
        const config = readBlock<DesignSystemConfig>(root.source, 'design-system');
        return (
          config && entryOf(root.id, config, await treeOf(transport, root, titles, 0, archived))
        );
      });
      seen.add(page.id);
      if (entry) {
        for (const id of treeIds(entry.tree)) seen.add(id);
        systems.push(entry);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      failed.push(page);
    }
  }
  // A page that failed as a candidate but was then read inside a found tree is not missing.
  return {
    systems,
    unreadable: failed.filter((page) => !seen.has(page.id)).map((page) => page.title),
  };
}

/** Mark a system's pages as design-system pages with the reserved project, keeping each page's
 * other projects. */
export async function markDesignPages(transport: PageTransport, ids: readonly string[]) {
  const management = transport.management;
  if (!management) throw new Error('Only the owner can make a design system.');
  const home = await transport.spaceHome();
  const projects = new Map(home.pages.map((page) => [page.id, page.projects ?? []]));
  // A request lists at most PROJECT_REQUEST_PAGES pages, in ID order.
  const sorted = [...ids].sort();
  for (let start = 0; start < sorted.length; start += PROJECT_REQUEST_PAGES)
    await management.setProjects(
      sorted.slice(start, start + PROJECT_REQUEST_PAGES).map((pageId) => ({
        pageId,
        projects: [...new Set([...(projects.get(pageId) ?? []), DESIGN_PROJECT])],
      })),
    );
}
const treeIds = (node: DesignTreeNode): string[] => [node.id, ...node.children.flatMap(treeIds)];

/** Make a design system from the TMT template as its own top-level tree, every page marked. */
export async function createDesignSystem(
  transport: PageTransport,
  { name, prefix }: { name: string; prefix: string },
): Promise<string> {
  const rootId = await newRoot(transport, name);
  await fillFromTemplate(transport, rootId, name, prefix);
  const tree = await withPage(transport, rootId, (root) => treeOf(transport, root, new Map(), 0));
  await markDesignPages(transport, treeIds(tree));
  return rootId;
}

/** Bring an existing system root (one made before the Design tab) into the Design tab. Its pages
 * keep their place; only the project is added. */
export async function adoptDesignSystem(transport: PageTransport, rootId: string): Promise<void> {
  const tree = await withPage(transport, rootId, async (root) => {
    if (!readBlock(root.source, 'design-system'))
      throw new Error('This page is not a design system.');
    return treeOf(transport, root, new Map(), 0);
  });
  await markDesignPages(transport, treeIds(tree));
}

/** Publish the system's next version from the Design header. */
export async function publishNext(
  transport: PageTransport,
  rootId: string,
): Promise<PublishResult & { version: string }> {
  return withPage(transport, rootId, async (root) => {
    const config = readBlock<DesignSystemConfig>(root.source, 'design-system');
    if (!config) throw new Error('This page is not a design system.');
    if (!root.binding) throw new Error('This design system cannot be published here.');
    const version = nextVersion(config);
    return {
      ...(await publishDesignSystem(transport, rootId, root.binding, root.source, version)),
      version,
    };
  });
}
