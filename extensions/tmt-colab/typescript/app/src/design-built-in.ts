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

interface DocSection {
  title: string;
  pages: { slug: string; title: string; html: string; path: string }[];
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
  ]).then(([{ default: template }, { default: pages }]) => {
    const { system } = template as unknown as { system: DesignSystemConfig };
    const sections = pages as unknown as DocSection[];
    const intro = `<div class="tmt-design-docs"><article class="docs-article"><h1>${escape(system.name)}</h1>
<p class="docs-lead">${escape(system.principles?.summary ?? '')}</p>
${sections
  .map(
    (section) =>
      `<h2>${escape(section.title)}</h2><ul class="docs-list">${section.pages
        .map((doc) => `<li><a href="${builtInLink(doc.path)}">${escape(doc.title)}</a></li>`)
        .join('')}</ul>`,
  )
  .join('\n')}
</article></div>`;
    const byPath = new Map<string, { title: string; source: string }>([
      ['', { title: system.name, source: writePin(intro, BUILT_IN_SYSTEM) }],
      ...sections.flatMap((section) =>
        section.pages.map(
          (doc) =>
            [doc.path, { title: doc.title, source: writePin(doc.html, BUILT_IN_SYSTEM) }] as const,
        ),
      ),
    ]);
    const tags = new Set(system.components.map((component) => component.tag));
    const tree: DesignTreeNode = {
      id: '',
      key: '',
      title: system.name,
      kind: 'design-system',
      children: sections.map((section) => ({
        id: `section:${section.title}`,
        title: section.title,
        kind: 'section',
        children: section.pages.map((doc) => ({
          id: doc.path,
          key: doc.path,
          title: doc.title,
          kind: 'page',
          ...(section.title.endsWith('omponents') && tags.has(doc.slug) && { tag: doc.slug }),
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

/** The Colab page that holds a built-in docs page's comments and Chat, if one was made. */
export async function findBuiltInDiscussion(
  transport: PageTransport,
  path: string,
  title: string,
): Promise<string | undefined> {
  return (await discussionPages(transport, path, title))[0];
}

/** The docs path's discussion page, made now if there is none. Two tabs may make one each at once:
 * each then keeps the lowest id and archives its own page if that is not it, so one page stays. */
export async function ensureBuiltInDiscussion(
  transport: PageTransport,
  path: string,
  page: { title: string; source: string },
): Promise<string> {
  const found = await findBuiltInDiscussion(transport, path, page.title);
  if (found) return found;
  const management = transport.management;
  if (!management) throw new Error('Only the owner can start a discussion here.');
  const id = await newRoot(transport, discussionTitle(page.title));
  const annotates: Annotates = { system: BUILT_IN_SYSTEM, path };
  await withPage(transport, id, async (made) => {
    await made.binding!.edit(`${blockHtml('annotates', annotates)}\n${page.source}`, made.source);
  });
  await markDesignPages(transport, [id]);
  const [keep = id] = await discussionPages(transport, path, page.title);
  if (keep !== id) await runPageOperation(management, id, 'page.archive');
  return keep;
}
