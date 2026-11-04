import type { ComponentDoc, DesignSystemConfig } from '../../../../../design/systems/compiler.mjs';
import {
  BUILT_IN_SYSTEM,
  blockHtml,
  componentPageSource,
  isDesignSystemPage,
  markDesignPages,
  newRoot,
  readBlock,
  rootPageSource,
  sectionSource,
  withPage,
  writePin,
} from './design-system-pages.js';
import { runPageOperation } from './page-operations.js';
import type { PageTransport } from './transport.js';
import { subpages } from './work.js';

/*
 * The built-in tmt GUI as Colab pages (#5969): a mirror of the docs `design/browser-ui` generates
 * (`design/systems/tmt-gui/generated/{template,pages}.json`), so Design shows it as pages people
 * can point at, comment on and ask an agent about. The code stays the source: a change goes
 * through a PR to `design/browser-ui`, and the app regenerates the pages from the build it ships.
 * Each page carries an `origin` block with its docs path (`components/button`) and the files it is
 * generated from; regeneration rewrites a page in place by that path, so its id and threads stay,
 * and archives (never deletes) a page whose entry is gone. Every page follows `tmt-gui`, whose
 * draft is the shipped release (#5967).
 */

/** What every mirror page says first; the files name what a change edits. */
export const GENERATED_NOTE =
  'Generated from design/browser-ui; change it through a PR, since edits here are replaced.';

export interface MirrorOrigin {
  /** The docs path: '' for the root, `components` for a section, `components/button` for a page. */
  readonly key: string;
  /** Repo-relative files the page is generated from. */
  readonly files?: readonly string[];
  /** The root only: the shipped bundle hash the tree was generated from. */
  readonly bundle?: string;
}

interface DocSection {
  title: string;
  pages: { slug: string; title: string; html: string; files?: string[] }[];
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** One quiet line (#6060); the files stay in the origin block, not in the page text. */
const note = () =>
  `<p class="text-xs text-secondary mb-2" data-tmt-ds-generated="">${escape(GENERATED_NOTE)}</p>`;
/** A mirror page's whole source: the follow pin, its origin, the note, then its body. */
export const mirrorSource = (origin: MirrorOrigin, body: string) =>
  writePin(`${blockHtml('origin', origin)}\n${note()}\n${body}`, BUILT_IN_SYSTEM);

/** The generated docs and the shipped bundle, loaded only when the mirror is made or checked. */
async function generated() {
  const [{ default: template }, { default: pages }, { default: bundle }] = await Promise.all([
    import('../../../../../design/systems/tmt-gui/generated/template.json'),
    import('../../../../../design/systems/tmt-gui/generated/pages.json'),
    import('../../../../../design/systems/tmt-gui/generated/bundle.json'),
  ]);
  const { system, components } = template as unknown as {
    system: DesignSystemConfig;
    components: (ComponentDoc & { notes?: string })[];
  };
  return {
    system,
    live: new Map(components.map((doc) => [doc.tag, doc])),
    sections: pages as unknown as DocSection[],
    hash: (bundle as unknown as { hash: string }).hash,
  };
}

/** The shipped bundle's hash: a mirror made from another build regenerates. */
export const shippedBundle = async () => (await generated()).hash;

/** Make the mirror (no `rootId`) or regenerate it in place, and return its root page id. Pages are
 * opened one at a time, as listing does; a page already up to date is not edited.
 *
 * Every owner tab and device syncs on its first Design visit, so two can run at once. They
 * converge: a new page carries its origin block as soon as it exists, a sync reuses a root or a
 * child it finds by key before making one, and it ends with a second pass that archives a second
 * root's tree and any second page for a key. The lowest page id stays, so every device keeps the
 * same one. */
export async function syncBuiltInMirror(
  transport: PageTransport,
  rootId?: string,
): Promise<string> {
  const { system } = await generated();
  let root = rootId ?? (await builtInRoots(transport, system.name))[0];
  if (!root) {
    root = await newRoot(transport, system.name);
    // Claimed at once, so a sync elsewhere finds this root instead of making its own.
    await write(transport, root, mirrorSource({ key: '' }, ''));
    await markDesignPages(transport, [root]);
  }
  await fill(transport, root);
  const [keep = root, ...extra] = await builtInRoots(transport, system.name);
  for (const id of extra)
    await archive(transport, [id, ...[...(await tree(transport, id)).values()].flat()]);
  // The second pass archives a key's second page and relinks the sections to what stays.
  await fill(transport, keep);
  return keep;
}

const write = (transport: PageTransport, id: string, source: string) =>
  withPage(transport, id, async (page) => {
    if (page.source !== source) await page.binding!.edit(source, page.source);
  });
const archive = async (transport: PageTransport, ids: readonly string[]) => {
  for (const id of ids)
    if (transport.management) await runPageOperation(transport.management, id, 'page.archive');
};
const originOf = (transport: PageTransport, id: string) =>
  withPage(transport, id, async (page) => readBlock<MirrorOrigin>(page.source, 'origin'));
const archivedPages = async (transport: PageTransport) =>
  new Set(
    (await transport.spaceHome()).pages.filter((page) => page.archived).map((page) => page.id),
  );

/** The live built-in roots, lowest id first: design pages titled as the system whose origin is the
 * root's. */
async function builtInRoots(transport: PageTransport, name: string): Promise<string[]> {
  const home = await transport.spaceHome();
  const roots: string[] = [];
  for (const page of home.pages)
    if (
      isDesignSystemPage(page) &&
      !page.archived &&
      (page.title === name || page.titleMissing) &&
      (await originOf(transport, page.id))?.key === ''
    )
      roots.push(page.id);
  return roots.sort();
}

/** A root's live pages by docs path; a path two syncs both made has two ids, lowest first. */
async function tree(transport: PageTransport, root: string, archived?: ReadonlySet<string>) {
  const gone = archived ?? (await archivedPages(transport));
  const byKey = new Map<string, string[]>();
  const visit = async (id: string, depth: number): Promise<void> => {
    const children = await withPage(transport, id, async (page) => {
      const origin = readBlock<MirrorOrigin>(page.source, 'origin');
      if (origin && id !== root) byKey.set(origin.key, [...(byKey.get(origin.key) ?? []), id]);
      return depth >= 2 ? [] : subpages(page.work);
    });
    for (const child of children) if (!gone.has(child)) await visit(child, depth + 1);
  };
  await visit(root, 0);
  for (const ids of byKey.values()) ids.sort();
  return byKey;
}

/** Write the tree under `root` from the shipped docs. */
async function fill(transport: PageTransport, root: string) {
  const { system, live, sections, hash } = await generated();
  const archived = await archivedPages(transport);
  const pages = await tree(transport, root, archived);
  // A path's second page (a race between two syncs) is archived; the lowest id stays.
  const byKey = new Map([...pages].map(([key, ids]) => [key, ids[0]!]));
  await archive(
    transport,
    [...pages.values()].flatMap((ids) => ids.slice(1)),
  );
  const kept = new Map<string, string>();
  const place = async (parent: string, key: string, title: string) => {
    const id =
      byKey.get(key) ??
      (await childFor(transport, parent, key, archived)) ??
      (await create(transport, parent, key, title));
    kept.set(key, id);
    return id;
  };
  const entries: DesignSystemConfig['components'] = [];
  for (const section of sections) {
    const sectionKey = section.title.toLowerCase();
    const sectionId = await place(root, sectionKey, section.title);
    const made: { id: string; title: string }[] = [];
    for (const doc of section.pages) {
      const key = `${sectionKey}/${doc.slug}`;
      const id = await place(sectionId, key, doc.title);
      const component = section.title === 'Components' ? live.get(doc.slug) : undefined;
      const body = component ? componentPageSource(component, system.prefix) : doc.html;
      await write(transport, id, mirrorSource({ key, files: doc.files ?? [] }, body));
      if (component) entries.push({ page: id, tag: component.tag, status: 'stable' });
      made.push({ id, title: doc.title });
    }
    await write(
      transport,
      sectionId,
      mirrorSource({ key: sectionKey }, sectionSource(section.title, made)),
    );
  }
  const config: DesignSystemConfig = { ...system, id: root, components: entries, releases: [] };
  await write(transport, root, mirrorSource({ key: '', bundle: hash }, rootPageSource(config)));
  // A page whose docs entry is gone keeps its threads: archived, never deleted.
  await archive(
    transport,
    [...byKey].filter(([key]) => !kept.has(key)).map(([, id]) => id),
  );
  await markDesignPages(transport, [root, ...kept.values()]);
}

/** The parent's live sub-page for `key`, read again now: another sync may have just made it. */
async function childFor(
  transport: PageTransport,
  parent: string,
  key: string,
  archived: ReadonlySet<string>,
) {
  const children = await withPage(transport, parent, async (page) => subpages(page.work));
  for (const child of [...children].sort())
    if (!archived.has(child) && (await originOf(transport, child))?.key === key) return child;
  return undefined;
}

/** Make the sub-page and claim it with its origin at once, so a sync elsewhere finds it. */
async function create(transport: PageTransport, parent: string, key: string, title: string) {
  const id = await withPage(transport, parent, async (page) => {
    if (!page.binding?.work) throw new Error('The tmt GUI pages cannot hold sub-pages.');
    const made = await page.binding.work('subpage.create', { title });
    if (!made.childPage) throw new Error(`The ${title} page was not made.`);
    return made.childPage;
  });
  await write(transport, id, mirrorSource({ key }, ''));
  return id;
}
