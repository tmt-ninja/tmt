import type { DesignSystemConfig } from '../../../../../design/systems/compiler.mjs';
import {
  BUILT_IN_SYSTEM,
  blockHtml,
  isDesignSystemPage,
  markDesignPages,
  newRoot,
  readBlock,
  withPage,
  writePin,
  type DesignSystemEntry,
  type DesignTreeNode,
} from './design-system-pages.js';
import { runPageOperation } from './page-operations.js';
import type { PageTransport } from './transport.js';

/*
 * The built-in tmt GUI in Design (#6060): drawn from the docs and bundle this build ships, as the
 * docs site draws them, and never stored as Colab pages. A page's comments and Chat need a Colab
 * page, so the first Comment or Chat on a docs path makes one for that path (its title, an
 * `annotates` block and the shipped source the quotes anchor to), and later visits find it by path.
 * Design always draws the shipped source, never that page's stored copy.
 */

interface DocPage {
  slug: string;
  title: string;
  html: string;
  path: string;
}
/** The docs site's own nav (design/browser-ui/docs/app.tsx), as compile.mjs writes it: Design draws
 * this, not its own grouping, so the two cannot drift; `pages` holds the pages only the nav lists. */
interface DocsNav {
  sections: { title: string; pages: { title: string; path: string }[] }[];
  pages: DocPage[];
}

/** The shipped built-in system: its Design tree and each page's source by docs path. */
export interface BuiltInDesign {
  entry: DesignSystemEntry;
  /** A docs path's shipped source and title; '' is the system's introduction. */
  page(path: string): { title: string; source: string } | undefined;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A link a built-in page draws to another: Design routes `/p/<path>` within the tree. */
export const builtInLink = (path: string) => `/p/${encodeURIComponent(path)}`;

let loaded: Promise<BuiltInDesign> | undefined;
/** The shipped tmt GUI, loaded once per app when Design first shows it. */
export function builtInDesign(): Promise<BuiltInDesign> {
  loaded ??= Promise.all([
    import('../../../../../design/systems/tmt-gui/generated/template.json'),
    import('../../../../../design/systems/tmt-gui/generated/pages.json'),
    import('../../../../../design/systems/tmt-gui/generated/nav.json'),
  ]).then(([{ default: template }, { default: pages }, { default: navJson }]) => {
    const { system } = template as unknown as { system: DesignSystemConfig };
    const nav = navJson as unknown as DocsNav;
    const docs = new Map(
      [
        ...(pages as unknown as { pages: DocPage[] }[]).flatMap((section) => section.pages),
        ...nav.pages,
      ].map((doc) => [doc.path, doc] as const),
    );
    const intro = `<div class="tmt-design-docs"><article class="docs-article"><h1>${escape(system.name)}</h1>
<p class="docs-lead">${escape(system.principles?.summary ?? '')}</p>
${nav.sections
  .map(
    (section) =>
      `<h2>${escape(section.title)}</h2><ul class="docs-list">${section.pages
        .filter((doc) => doc.path)
        .map((doc) => `<li><a href="${builtInLink(doc.path)}">${escape(doc.title)}</a></li>`)
        .join('')}</ul>`,
  )
  .join('\n')}
</article></div>`;
    const byPath = new Map<string, { title: string; source: string }>([
      ['', { title: 'Introduction', source: writePin(intro, BUILT_IN_SYSTEM) }],
    ]);
    for (const section of nav.sections)
      for (const { path, title } of section.pages) {
        if (!path) continue;
        const doc = docs.get(path);
        if (!doc) throw new Error(`The docs nav lists ${path}, which the build does not ship.`);
        byPath.set(path, { title, source: writePin(doc.html, BUILT_IN_SYSTEM) });
      }
    const tree: DesignTreeNode = {
      id: '',
      key: '',
      title: system.name,
      kind: 'design-system',
      children: nav.sections.map((section) => ({
        id: `section:${section.title}`,
        title: section.title,
        kind: 'section',
        children: section.pages.map(({ path, title }) => ({
          id: path,
          key: path,
          title,
          kind: 'page',
          children: [],
        })),
      })),
    };
    return {
      entry: {
        id: BUILT_IN_SYSTEM,
        name: system.name,
        prefix: system.prefix,
        version: system.version,
        next: system.version,
        config: system,
        tree,
        builtIn: true,
      },
      page: (path) => byPath.get(path),
    };
  });
  return loaded;
}

/** What a built-in page's Colab page carries to name the docs path it discusses. */
interface Annotates {
  system: string;
  path: string;
}
/** The Colab page title for a built-in docs page's discussion. */
const discussionTitle = (title: string) => `${title} · tmt GUI`;

/** A docs path's live discussion pages, lowest id first. */
async function discussionPages(transport: PageTransport, path: string, title: string) {
  const home = await transport.spaceHome();
  const found: string[] = [];
  for (const page of home.pages)
    if (isDesignSystemPage(page) && !page.archived && page.title === discussionTitle(title)) {
      const block = await withPage(transport, page.id, async (opened) =>
        readBlock<Annotates>(opened.source, 'annotates'),
      );
      if (block?.system === BUILT_IN_SYSTEM && block.path === path) found.push(page.id);
    }
  return found.sort();
}

/** The docs path's discussion page: the lowest id. Two tabs may each make one at once, so every
 * find also archives the others, whoever made them; a viewer who cannot manage pages only reads. */
async function settleDiscussion(
  transport: PageTransport,
  path: string,
  title: string,
): Promise<string | undefined> {
  const [keep, ...extra] = await discussionPages(transport, path, title);
  const management = transport.management;
  if (management)
    for (const id of extra) await runPageOperation(management, id, 'page.archive').catch(() => {});
  return keep;
}

/** The Colab page that holds a built-in docs page's comments and Chat, if one was made. */
export function findBuiltInDiscussion(
  transport: PageTransport,
  path: string,
  title: string,
): Promise<string | undefined> {
  return settleDiscussion(transport, path, title);
}

/** Discussion pages being made in this tab, by transport and docs path: a second press waits for
 * the first instead of making another page. */
const making = new WeakMap<PageTransport, Map<string, Promise<string>>>();

/** The docs path's discussion page, made now if there is none. A page this call made but could not
 * finish (its block or Design mark failed) is archived, so no half-made page stays. */
export function ensureBuiltInDiscussion(
  transport: PageTransport,
  path: string,
  page: { title: string; source: string },
): Promise<string> {
  const own = making.get(transport) ?? new Map<string, Promise<string>>();
  making.set(transport, own);
  const pending = own.get(path);
  if (pending) return pending;
  const made = makeDiscussion(transport, path, page).finally(() => own.delete(path));
  own.set(path, made);
  return made;
}

async function makeDiscussion(
  transport: PageTransport,
  path: string,
  page: { title: string; source: string },
): Promise<string> {
  const found = await settleDiscussion(transport, path, page.title);
  if (found) return found;
  const management = transport.management;
  if (!management) throw new Error('Only the owner can start a discussion here.');
  const id = await newRoot(transport, discussionTitle(page.title));
  const annotates: Annotates = { system: BUILT_IN_SYSTEM, path };
  try {
    await withPage(transport, id, async (opened) => {
      await opened.binding!.edit(
        `${blockHtml('annotates', annotates)}\n${page.source}`,
        opened.source,
      );
    });
    await markDesignPages(transport, [id]);
  } catch (failure) {
    await runPageOperation(management, id, 'page.archive').catch(() => {});
    throw failure;
  }
  return (await settleDiscussion(transport, path, page.title)) ?? id;
}
