/** The closed shape of a structured page's `blocks` value (#6004): a map from block id to block,
 * each with its type, place in the tree, props under the type's schema, and text with inline marks.
 * Mirrors `blocks::schema` and `blocks::text` in the native crate, and both run
 * `contracts/vectors/blocks-v1.json`. No Yjs, storage or authority. */
import {
  byteLength,
  canonical,
  id,
  keys,
  multiline,
  nonempty,
  object,
  plain,
  requireValue,
} from './closed.js';

export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'list',
  'todo',
  'table',
  'card',
  'question',
  'callout',
  'code',
  'image',
  'mockup',
  'work-bundle',
  'page-view',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
/** A table's rows are blocks of this type; only `table add-row` makes one. */
export const ROW = 'row';
/** The parent of a block that sits on the page itself. */
export const ROOT = 'root';

export const BLOCKS = 2048;
export const BLOCK_PROPS_BYTES = 8 * 1024;
export const BLOCK_TEXT_BYTES = 64 * 1024;
export const BLOCK_CELL_BYTES = 4 * 1024;
export const BLOCK_ROW_CELLS = 64;
export const BLOCK_TABLE_ROWS = 512;
export const BLOCK_TABLE_COLUMNS = 32;
export const BLOCK_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_TIME = Number.MAX_SAFE_INTEGER;

/** Every mark, in the order that breaks a tie between two ranges that start and end together. */
export const MARKS = ['bold', 'italic', 'code', 'link', 'agent', 'block'] as const;
const FLAGS = 3;
export interface Mark {
  from: number;
  to: number;
  mark: (typeof MARKS)[number];
  value?: string;
}
export interface RichText {
  s: string;
  marks: Mark[];
}
/** One block of the projected `blocks` value, as `validateBlocks` accepts it: its type (one of
 * `BLOCK_TYPES`, or the internal `ROW`), its place in the tree, its props under the type's schema,
 * its text when the type has one, a table row's cells, and the time it was deleted. */
export interface BlockEntry {
  type: string;
  parent: string;
  pos: string;
  props: Record<string, unknown>;
  text?: RichText;
  cells?: Record<string, RichText>;
  deleted?: number;
}

/** The schemes a link mark, and a file's `href`, may use. */
const LINK_SCHEMES = ['https://', 'http://', 'mailto:'] as const;
/** The one URL rule: at most 2048 bytes, one of `schemes` followed by something, and no control or
 * whitespace character. A `javascript:` or `data:` URL, a relative one and one with a space are
 * all refused, whatever block or mark carries them. Mirrors `safe_url` in `blocks/text.rs`. */
export function safeUrl(value: unknown, schemes: readonly string[]): boolean {
  return (
    typeof value === 'string' &&
    byteLength(value) <= 2048 &&
    schemes.some((scheme) => value.length > scheme.length && value.startsWith(scheme)) &&
    !/[\p{Cc} \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u.test(value)
  );
}
const ATTACHMENT = 'colab-attachment:';
/** The token of a `colab-attachment:` reference, the grammar an HTML page uses: 8 lowercase hex
 * digits (a unique ID prefix) or a full attachment ID; `null` is anything else. */
export function attachmentToken(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(ATTACHMENT)) return null;
  const token = value.slice(ATTACHMENT.length);
  return /^[0-9a-f]{8}$/.test(token) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)
    ? token
    : null;
}
/** An image's `src`: an attachment reference or an `https` URL, nothing else. */
export function imageSource(value: unknown): boolean {
  return attachmentToken(value) !== null || safeUrl(value, LINK_SCHEMES.slice(0, 1));
}
/** A file's `href`: an attachment reference or a link's URL. */
export function fileHref(value: unknown): boolean {
  return attachmentToken(value) !== null || safeUrl(value, LINK_SCHEMES);
}

/** A generated ID: a lowercase v4 UUID, as the serve's `values::generated_id`. */
const GENERATED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validMarkValue(mark: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (mark === 'link') return safeUrl(value, LINK_SCHEMES);
  if (mark === 'agent')
    return (
      value !== '' &&
      byteLength(value) <= 128 &&
      !/[\p{Cc} \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u.test(value)
    );
  if (mark === 'block') {
    // A block on this page by its ID, or on another page as `<pageId>/<blockId>` (#6208).
    const ids = value.split('/');
    return ids.length <= 2 && ids.every((id) => GENERATED_ID.test(id));
  }
  return false;
}
/** Line feeds and tabs are text; every other control character is not. */
export function validText(value: unknown, bytes: number): value is string {
  return (
    typeof value === 'string' &&
    byteLength(value) <= bytes &&
    !/[\p{Cc}\p{Cs}]/u.test(value.replaceAll('\n', '').replaceAll('\t', ''))
  );
}

/** Per-character marks: three flags and the interned values of the three valued marks. */
class Attrs {
  flags = 0;
  values: [number, number, number] = [0, 0, 0];
  get(mark: number): number {
    return mark < FLAGS ? (this.flags >> mark) & 1 : this.values[mark - FLAGS]!;
  }
  set(mark: number, value: number) {
    if (mark < FLAGS) this.flags = (this.flags & ~(1 << mark)) | ((value !== 0 ? 1 : 0) << mark);
    else this.values[mark - FLAGS] = value;
  }
}

/** The canonical projection of per-character marks: maximal runs of one mark and value, ordered
 * by start, end and mark. */
function marksOf(attrs: Attrs[], table: string[]): Mark[] {
  const runs: [number, number, number, number][] = [];
  for (let mark = 0; mark < MARKS.length; mark++) {
    let start = 0;
    while (start < attrs.length) {
      const value = attrs[start]!.get(mark);
      let end = start + 1;
      while (end < attrs.length && attrs[end]!.get(mark) === value) end++;
      if (value !== 0) runs.push([start, end, mark, value]);
      start = end;
    }
  }
  runs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  return runs.map(([from, to, mark, value]) => ({
    from,
    to,
    mark: MARKS[mark]!,
    ...(mark >= FLAGS ? { value: table[value - 1]! } : {}),
  }));
}

/** Parse `{"s","marks"}`: exact keys, text within `bytes`, marks only when `rich`, ranges inside
 * the text, valid values, one value per mark and character, and the canonical order and run
 * merging (so a value has exactly one spelling). */
export function validateRich(
  value: unknown,
  rich: boolean,
  bytes: number,
): asserts value is RichText {
  keys(value, ['s', 'marks']);
  const { s, marks } = value as Record<string, unknown>;
  requireValue(validText(s, bytes));
  requireValue(Array.isArray(marks) && (rich || marks.length === 0));
  const chars = Array.from(s as string);
  const attrs = chars.map(() => new Attrs());
  const table: string[] = [];
  for (const mark of marks as unknown[]) {
    keys(mark, ['from', 'to', 'mark'], ['value']);
    const { from, to, mark: name, value: given } = mark as Record<string, unknown>;
    requireValue(typeof name === 'string');
    const index = (MARKS as readonly string[]).indexOf(name);
    requireValue(index >= 0);
    requireValue(Number.isSafeInteger(from) && Number.isSafeInteger(to));
    const [a, b] = [from as number, to as number];
    requireValue(a >= 0 && a < b && b <= chars.length);
    let interned = 1;
    if (index < FLAGS) requireValue(!Object.hasOwn(mark as object, 'value'));
    else {
      requireValue(validMarkValue(name, given));
      const at = table.indexOf(given as string);
      interned = (at >= 0 ? at : table.push(given as string) - 1) + 1;
    }
    for (let i = a; i < b; i++) {
      requireValue(attrs[i]!.get(index) === 0);
      attrs[i]!.set(index, interned);
    }
  }
  requireValue(canonical(value) === canonical({ s, marks: marksOf(attrs, table) }));
}

/** One run of a `Y.Text` delta: its characters and the attributes on them. */
export interface Run {
  insert: unknown;
  attributes?: Record<string, unknown>;
}
/** The canonical text value of a `Y.Text`'s delta. Only plain string runs are text, and only the
 * closed marks are attributes; anything else is a rejection. */
export function richFromRuns(runs: Run[]): RichText {
  const chars: string[] = [];
  const attrs: Attrs[] = [];
  const table: string[] = [];
  for (const run of runs) {
    requireValue(typeof run.insert === 'string');
    const one = new Attrs();
    for (const [name, value] of Object.entries(run.attributes ?? {})) {
      const index = (MARKS as readonly string[]).indexOf(name);
      requireValue(index >= 0);
      if (index < FLAGS) {
        requireValue(value === true);
        one.set(index, 1);
      } else {
        requireValue(validMarkValue(name, value));
        const at = table.indexOf(value as string);
        one.set(index, (at >= 0 ? at : table.push(value as string) - 1) + 1);
      }
    }
    for (const char of Array.from(run.insert as string)) {
      chars.push(char);
      attrs.push(one);
    }
  }
  return { s: chars.join(''), marks: marksOf(attrs, table) };
}

/** A block of this type has text, and may carry marks only when `richType`. */
export function hasText(type: string): boolean {
  return ['paragraph', 'heading', 'list', 'todo', 'callout', 'code', 'question'].includes(type);
}
export function richType(type: string): boolean {
  return ['paragraph', 'heading', 'list', 'todo', 'callout'].includes(type);
}

/** A key that never ends in `0` and sorts by plain string order. */
export function validPos(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9A-Za-z]{1,64}$/.test(value) && !value.endsWith('0');
}

type Prop =
  | { kind: 'bool' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'int'; low: number; high: number }
  | { kind: 'text'; max: number }
  | { kind: 'date' }
  | { kind: 'id' }
  | { kind: 'custom'; check: (value: unknown) => void };
const bool: Prop = { kind: 'bool' };
const choice = (...values: string[]): Prop => ({ kind: 'enum', values });
const int = (low: number, high: number): Prop => ({ kind: 'int', low, high });
const line = (max: number): Prop => ({ kind: 'text', max });
const custom = (check: (value: unknown) => void): Prop => ({ kind: 'custom', check });
const indent = int(0, 2);

function list(value: unknown, max: number): unknown[] {
  requireValue(Array.isArray(value) && value.length <= max);
  return value;
}
function columnId(value: unknown): string {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value));
  return value;
}
function columns(value: unknown) {
  const seen = new Set<string>();
  for (const column of list(value, BLOCK_TABLE_COLUMNS)) {
    const map = keys(column, ['id', 'name'], ['width', 'hideNarrow']);
    const key = columnId(map.id);
    requireValue(!seen.has(key));
    seen.add(key);
    nonempty(map.name, 128);
    if (Object.hasOwn(map, 'width')) requireValue(map.width === 'auto' || map.width === 'narrow');
    if (Object.hasOwn(map, 'hideNarrow')) requireValue(typeof map.hideNarrow === 'boolean');
  }
}
function choices(value: unknown) {
  for (const item of list(value, 20)) nonempty(item, 256);
}
function images(value: unknown) {
  for (const image of list(value, 100)) {
    const map = keys(image, ['src'], ['alt', 'caption', 'tag', 'filename', 'status']);
    nonempty(map.src, 2048);
    requireValue(imageSource(map.src));
    for (const key of ['alt', 'caption', 'tag', 'filename'])
      if (Object.hasOwn(map, key)) plain(map[key], 1024);
    if (Object.hasOwn(map, 'status'))
      requireValue(map.status === 'loading' || map.status === 'error');
  }
}
function files(value: unknown) {
  for (const file of list(value, 100)) {
    const map = keys(file, ['name'], ['size', 'type', 'href']);
    nonempty(map.name, 256);
    for (const [key, max] of [
      ['size', 32],
      ['type', 128],
    ] as const)
      if (Object.hasOwn(map, key)) plain(map[key], max);
    if (Object.hasOwn(map, 'href')) {
      plain(map.href, 2048);
      requireValue(fileHref(map.href));
    }
  }
}
function tickets(value: unknown) {
  for (const ticket of list(value, 20)) {
    const map = keys(ticket, ['label', 'href']);
    nonempty(map.label, 128);
    plain(map.href, 2048);
    requireValue((map.href as string).startsWith('https://github.com/'));
  }
}
/** Strings, integers, booleans, arrays and objects of bounded depth: no floats, no null. */
function jsonShape(value: unknown, depth: number): boolean {
  if (depth > 4) return false;
  if (typeof value === 'string') return byteLength(value) <= 1024 && !/[\p{Cc}\p{Cs}]/u.test(value);
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  if (Array.isArray(value)) return value.every((item) => jsonShape(item, depth + 1));
  if (value !== null && typeof value === 'object')
    return Object.entries(value).every(
      ([key, item]) => byteLength(key) <= 64 && jsonShape(item, depth + 1),
    );
  return false;
}
function rows(value: unknown) {
  list(value, 200);
  requireValue(byteLength(canonical(value)) <= 24 * 1024 && jsonShape(value, 0));
}
function filters(value: unknown) {
  for (const filter of list(value, 20)) {
    const map = keys(filter, ['field', 'value']);
    requireValue(['project', 'state', 'owner'].includes(map.field as string));
    plain(map.value, 128);
  }
}
function columnNames(value: unknown) {
  for (const item of list(value, 32)) nonempty(item, 64);
}
function markup(value: unknown) {
  multiline(value, 64 * 1024);
}

const SCHEMA: Record<string, Record<string, Prop>> = {
  paragraph: { tone: choice('default', 'muted') },
  heading: { level: int(2, 3) },
  list: { style: choice('bullet', 'number'), indent },
  todo: { checked: bool, assignee: line(128), due: { kind: 'date' }, indent },
  table: {
    label: line(256),
    columns: custom(columns),
    header: bool,
    density: choice('roomy', 'compact'),
  },
  card: {
    variant: choice('card', 'section'),
    title: line(256),
    meta: line(128),
    collapsible: bool,
    collapsed: bool,
  },
  question: {
    kind: choice('single', 'multiple', 'short'),
    agent: line(128),
    choices: custom(choices),
    other: bool,
    otherMax: int(1, 2000),
    state: choice('waiting', 'answered', 'dismissed'),
    answer: line(2000),
  },
  callout: {
    tone: choice('working', 'waiting', 'review', 'blocked'),
    label: line(64),
    heading: line(256),
  },
  code: { language: line(32), filename: line(256) },
  image: {
    images: custom(images),
    files: custom(files),
    layout: choice('carousel', 'grid', 'single'),
    size: choice('s', 'm', 'l'),
    variant: choice('image', 'file'),
  },
  mockup: {
    system: line(64),
    lock: line(64),
    preset: choice('390', '1440', 'custom'),
    width: int(1, 4000),
    height: int(0, 100_000),
    toolbarLabels: line(512),
    markup: custom(markup),
  },
  'work-bundle': {
    page: { kind: 'id' },
    number: int(1, 0xffffffff),
    work: line(2000),
    editable: bool,
    tickets: custom(tickets),
  },
  'page-view': {
    label: line(128),
    rows: custom(rows),
    filters: custom(filters),
    columns: custom(columnNames),
    sort: choice('updated', 'title'),
    limit: int(1, 200),
    groupBy: choice('state', 'project', 'owner', 'none'),
    state: choice('auto', 'loading', 'empty', 'error'),
    density: choice('compact', 'comfortable'),
    selected: line(128),
    selectable: bool,
  },
};
/** What a type's props may hold in all, as canonical JSON bytes. */
function propsBytes(type: string): number {
  return type === 'mockup'
    ? 72 * 1024
    : type === 'image' || type === 'page-view'
      ? 32 * 1024
      : BLOCK_PROPS_BYTES;
}

/** The props of one block: only keys of its type's schema, each valid, within the type's size. */
export function validateProps(type: string, props: unknown) {
  const map = object(props);
  requireValue(byteLength(canonical(props)) <= propsBytes(type));
  const schema = SCHEMA[type] ?? {};
  for (const [key, value] of Object.entries(map)) {
    const prop = Object.hasOwn(schema, key) ? schema[key]! : undefined;
    requireValue(prop !== undefined);
    switch (prop.kind) {
      case 'bool':
        requireValue(typeof value === 'boolean');
        break;
      case 'enum':
        requireValue(typeof value === 'string' && prop.values.includes(value));
        break;
      case 'int':
        requireValue(
          Number.isSafeInteger(value) &&
            (value as number) >= prop.low &&
            (value as number) <= prop.high,
        );
        break;
      case 'text':
        plain(value, prop.max);
        break;
      case 'date':
        requireValue(
          typeof value === 'string' &&
            /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(value),
        );
        break;
      case 'id':
        id(value);
        break;
      case 'custom':
        prop.check(value);
        break;
    }
  }
  // A mockup draws nothing without its markup, and a work card nothing without its page.
  if (type === 'mockup') requireValue(Object.hasOwn(map, 'markup'));
  if (type === 'work-bundle') requireValue(Object.hasOwn(map, 'page'));
}

function validateBlock(key: string, block: unknown, all: Record<string, unknown>) {
  const map = keys(block, ['type', 'parent', 'pos', 'props'], ['text', 'cells', 'deleted']);
  requireValue(typeof map.type === 'string' && typeof map.parent === 'string');
  const type = map.type;
  const parent = map.parent;
  requireValue(parent !== key && validPos(map.pos));
  if (Object.hasOwn(map, 'deleted'))
    requireValue(
      Number.isSafeInteger(map.deleted) &&
        (map.deleted as number) >= 0 &&
        (map.deleted as number) <= MAX_TIME,
    );
  const parentBlock = Object.hasOwn(all, parent) ? all[parent] : undefined;
  const parentType =
    parentBlock !== null && typeof parentBlock === 'object'
      ? ((parentBlock as Record<string, unknown>).type as string | undefined)
      : undefined;
  if (type === ROW) {
    requireValue(
      object(map.props) &&
        Object.keys(map.props as object).length === 0 &&
        !Object.hasOwn(map, 'text'),
    );
    requireValue(parentType === 'table');
    const cells = object(map.cells);
    requireValue(Object.keys(cells).length <= BLOCK_ROW_CELLS);
    for (const [column, cell] of Object.entries(cells)) {
      columnId(column);
      validateRich(cell, true, BLOCK_CELL_BYTES);
    }
    return;
  }
  requireValue((BLOCK_TYPES as readonly string[]).includes(type) && !Object.hasOwn(map, 'cells'));
  requireValue(parent === ROOT || (parentType === 'card' && type !== 'card'));
  validateProps(type, map.props);
  if (hasText(type)) {
    requireValue(Object.hasOwn(map, 'text'));
    validateRich(map.text, richType(type), BLOCK_TEXT_BYTES);
  } else requireValue(!Object.hasOwn(map, 'text'));
}

/** The whole `blocks` value: at most `BLOCKS` entries (tombstones included), every one valid, no
 * table holding too many rows, and the whole within the document size. */
export function validateBlocks(blocks: unknown): asserts blocks is Record<string, BlockEntry> {
  const all = object(blocks);
  const entries = Object.entries(all);
  requireValue(entries.length <= BLOCKS);
  const rowsOf = new Map<string, number>();
  for (const [key, block] of entries) {
    id(key);
    validateBlock(key, block, all);
    if ((block as Record<string, unknown>).type === ROW) {
      const parent = (block as Record<string, string>).parent!;
      const count = (rowsOf.get(parent) ?? 0) + 1;
      rowsOf.set(parent, count);
      requireValue(count <= BLOCK_TABLE_ROWS);
    }
  }
  requireValue(byteLength(canonical(blocks)) <= BLOCK_DOCUMENT_BYTES);
}
