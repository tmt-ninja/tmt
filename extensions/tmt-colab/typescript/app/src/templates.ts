/** The owner's templates (#5077): the list `GET /api/templates` answers, as `tmt colab template ls
 * --json` prints it, and the orders the Templates page and the New page picker show. */
import { exactKeys, requireValue } from '@tmt/colab-client';
import { validTemplateName } from './template-marks.js';

export interface TemplateEntry {
  name: string;
  /** The template page's ID; a template of this space only. */
  id?: string;
  layout: 'column' | 'full' | 'canvas' | 'freeform';
  summary: string;
  source: 'builtIn' | 'space';
  default: boolean;
  usedBy: number;
  author?: string;
}
export interface TemplateListing {
  /** The name of the serving machine's default template. */
  default: string;
  templates: TemplateEntry[];
  /** The setting named a template that is gone; pages start from starter. */
  defaultGone?: string;
}
export const TEMPLATE_LIST_BYTES = 256 * 1024;
const LAYOUTS = ['column', 'full', 'canvas', 'freeform'];

/** Refuses anything but the listing's exact shape. */
export function validateListing(value: unknown): asserts value is TemplateListing {
  const listing = value as Record<string, unknown>;
  exactKeys(
    listing,
    Object.hasOwn(listing ?? {}, 'defaultGone')
      ? ['default', 'templates', 'defaultGone']
      : ['default', 'templates'],
  );
  requireValue(typeof listing.default === 'string' && Array.isArray(listing.templates));
  if ('defaultGone' in listing) requireValue(typeof listing.defaultGone === 'string');
  let defaults = 0;
  for (const raw of listing.templates as unknown[]) {
    const entry = raw as Record<string, unknown>;
    const keys = ['name', 'layout', 'summary', 'source', 'default', 'usedBy'];
    if (Object.hasOwn(entry ?? {}, 'id')) keys.push('id');
    if (Object.hasOwn(entry ?? {}, 'author')) keys.push('author');
    exactKeys(entry, keys);
    requireValue(
      validTemplateName(entry.name) &&
        LAYOUTS.includes(entry.layout as string) &&
        typeof entry.summary === 'string' &&
        (entry.source === 'builtIn' || entry.source === 'space') &&
        (entry.source === 'space') === (typeof entry.id === 'string') &&
        typeof entry.default === 'boolean' &&
        Number.isSafeInteger(entry.usedBy) &&
        (entry.usedBy as number) >= 0 &&
        (entry.author === undefined || typeof entry.author === 'string'),
    );
    if (entry.default) {
      defaults++;
      requireValue(entry.name === listing.default);
    }
  }
  requireValue(defaults === 1);
}

/** How many templates the last successful read listed, for the Colab menu's count; the menu reads
 * nothing itself. */
let lastCount: number | undefined;
const countListeners = new Set<() => void>();
export function templateCount(): number | undefined {
  return lastCount;
}
export function onTemplateCount(listener: () => void): () => void {
  countListeners.add(listener);
  return () => countListeners.delete(listener);
}
/** A read of the template list: the menu's count follows it. */
export function noteTemplates(listing: TemplateListing): TemplateListing {
  if (lastCount !== listing.templates.length) {
    lastCount = listing.templates.length;
    for (const listener of countListeners) listener();
  }
  return listing;
}

/** The owner's template list; any failure is one error for the caller to show. */
export async function readTemplates(mount: URL, signal?: AbortSignal): Promise<TemplateListing> {
  const response = await fetch(new URL('api/templates', mount), { signal });
  if (!response.ok) throw new Error(`Templates unavailable (${response.status})`);
  const length = Number(response.headers.get('Content-Length') ?? 0);
  requireValue(length <= TEMPLATE_LIST_BYTES);
  const text = await response.text();
  requireValue(text.length <= TEMPLATE_LIST_BYTES);
  const value: unknown = JSON.parse(text);
  validateListing(value);
  return value;
}

/** The Templates page and settings order: the default first, then TMT's, then this space's. */
export function catalogOrder(templates: readonly TemplateEntry[]): TemplateEntry[] {
  const rank = (t: TemplateEntry) => (t.default ? 0 : t.source === 'builtIn' ? 1 : 2);
  return [...templates].sort((a, b) => rank(a) - rank(b));
}

/** The New page picker order: the default, then up to three used most recently, then TMT's, then
 * this space's. `recent` is newest first. */
export function pickerOrder(
  templates: readonly TemplateEntry[],
  recent: readonly string[],
): TemplateEntry[] {
  const first = templates.filter((t) => t.default);
  const used = recent
    .filter((name) => !first.some((t) => t.name === name))
    .slice(0, 3)
    .flatMap((name) => templates.filter((t) => t.name === name));
  const rest = catalogOrder(templates).filter((t) => !t.default && !used.includes(t));
  return [...first, ...used, ...rest];
}

/** The terminal command that makes the same page; the default needs no `--template`. */
export function createCommand(title: string, template: TemplateEntry | undefined): string {
  const quoted = `"${(title.trim() || 'Notes').replace(/(["\\$`])/g, '\\$1')}"`;
  return `tmt colab page create --title ${quoted}${
    template && !template.default ? ` --template ${template.name}` : ''
  }`;
}
