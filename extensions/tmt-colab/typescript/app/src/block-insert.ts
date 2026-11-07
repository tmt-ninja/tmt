import { INSERT_TYPES, type BlockType } from './block-model.js';

/** One insert-menu entry as the design system's catalog gives it. */
export interface InsertEntry {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string;
}

/**
 * The insert menu's rows for what follows `/` (#6005, spec 插入選單): an entry stays while every
 * word of the query starts a word of its label, or the query starts its ID or shortcut, ignoring
 * case. Catalog order is kept, and entries whose label starts with the query come first. Entries
 * the editor cannot make yet are left out.
 */
export function filterInsert(entries: readonly InsertEntry[], query: string): InsertEntry[] {
  const typed = query.trim().toLowerCase().replace(/^\//, '');
  const makeable = entries.filter((entry) => Object.hasOwn(INSERT_TYPES, entry.id));
  if (!typed) return makeable;
  const words = typed.split(/\s+/);
  const matches = (entry: InsertEntry) => {
    const label = entry.label.toLowerCase();
    const labelWords = label.split(/[\s-]+/);
    return (
      words.every((word) => labelWords.some((part) => part.startsWith(word))) ||
      entry.id.toLowerCase().startsWith(typed) ||
      entry.shortcut.toLowerCase().replace(/^\//, '').startsWith(typed)
    );
  };
  const found = makeable.filter(matches);
  const leading = found.filter((entry) => entry.label.toLowerCase().startsWith(typed));
  return [...leading, ...found.filter((entry) => !leading.includes(entry))];
}

/** The block type an entry makes. */
export function insertType(id: string): BlockType {
  const type = INSERT_TYPES[id];
  if (!type) throw new Error(`The insert menu cannot make ${id}.`);
  return type;
}

/** Whether a key typed in a block opens the insert menu: `/` in an empty paragraph. */
export function opensInsert(key: string, block: { type: BlockType; text?: string }): boolean {
  return key === '/' && block.type === 'paragraph' && !block.text;
}
