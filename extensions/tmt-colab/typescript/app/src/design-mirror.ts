import type { ComponentDoc, DesignSystemConfig } from '../../../../../design/systems/compiler.mjs';
import {
  BUILT_IN_SYSTEM,
  blockHtml,
  componentPageSource,
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
  'Generated from design/browser-ui. Change it through a PR; an edit to this page is replaced at the next regeneration.';

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
const note = (files: readonly string[] = []) =>
  `<p class="font-mono text-xs text-secondary mb-2" data-tmt-ds-generated="">${escape(GENERATED_NOTE)}${
    files.length ? ` Files: ${files.map(escape).join(', ')}.` : ''
  }</p>`;
/** A mirror page's whole source: the follow pin, its origin, the note, then its body. */
export const mirrorSource = (origin: MirrorOrigin, body: string) =>
  writePin(`${blockHtml('origin', origin)}\n${note(origin.files)}\n${body}`, BUILT_IN_SYSTEM);

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
 * opened one at a time, as listing does; a page already up to date is not edited. */
export async function syncBuiltInMirror(
  transport: PageTransport,
  rootId?: string,
): Promise<string> {
  const { system, live, sections, hash } = await generated();
  const root = rootId ?? (await newRoot(transport, system.name));
  const home = await transport.spaceHome();
  const archived = new Set(home.pages.filter((page) => page.archived).map((page) => page.id));
  // The tree as it stands: each page's docs path, and its children.
  const byKey = new Map<string, string>();
  const visit = async (id: string, depth: number): Promise<void> => {
    const children = await withPage(transport, id, async (page) => {
      const origin = readBlock<MirrorOrigin>(page.source, 'origin');
      if (origin && id !== root) byKey.set(origin.key, id);
      return depth >= 2 ? [] : subpages(page.work);
    });
    for (const child of children) if (!archived.has(child)) await visit(child, depth + 1);
  };
  await visit(root, 0);
  const write = (id: string, source: string) =>
    withPage(transport, id, async (page) => {
      if (page.source !== source) await page.binding!.edit(source, page.source);
    });
  const kept = new Map<string, string>();
  const place = async (parent: string, key: string, title: string) => {
    const id =
      byKey.get(key) ??
      (await withPage(transport, parent, async (page) => {
        if (!page.binding?.work) throw new Error('The tmt GUI pages cannot hold sub-pages.');
        const made = await page.binding.work('subpage.create', { title });
        if (!made.childPage) throw new Error(`The ${title} page was not made.`);
        return made.childPage;
      }));
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
      await write(id, mirrorSource({ key, files: doc.files ?? [] }, body));
      if (component) entries.push({ page: id, tag: component.tag, status: 'stable' });
      made.push({ id, title: doc.title });
    }
    await write(sectionId, mirrorSource({ key: sectionKey }, sectionSource(section.title, made)));
  }
  const config: DesignSystemConfig = { ...system, id: root, components: entries, releases: [] };
  await write(root, mirrorSource({ key: '', bundle: hash }, rootPageSource(config)));
  // A page whose docs entry is gone keeps its threads: archived, never deleted.
  const gone = [...byKey].filter(([key]) => !kept.has(key)).map(([, id]) => id);
  for (const id of gone)
    if (transport.management) await runPageOperation(transport.management, id, 'page.archive');
  await markDesignPages(transport, [root, ...kept.values()]);
  return root;
}
