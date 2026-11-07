/**
 * Fractional order keys for blocks (#6005): a key can always be made between any two others, so an
 * insert or a move writes one block and never renumbers its siblings. Keys are non-empty strings of
 * base-62 digits compared as plain strings (code-unit order); a key never ends in the smallest
 * digit, so there is always room before it. Two writers may make the same key at once; the tree
 * then orders them by block ID.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const digit = (key: string, index: number) => {
  if (index >= key.length) return 0;
  const value = DIGITS.indexOf(key[index]!);
  if (value < 0) throw new Error(`Not a block position: ${key}`);
  return value;
};

/** Whether `key` is a position this module makes: base-62 digits, not ending in the smallest one. */
export function validPos(key: string): boolean {
  return key.length > 0 && [...key].every((c) => DIGITS.includes(c)) && !key.endsWith(DIGITS[0]!);
}

/**
 * A key strictly between `before` and `after`; `undefined` is the open end. Throws when the bounds
 * are not in order. The key is as short as the gap allows.
 */
export function posBetween(before?: string, after?: string): string {
  if (before !== undefined && !validPos(before)) throw new Error(`Not a block position: ${before}`);
  if (after !== undefined && !validPos(after)) throw new Error(`Not a block position: ${after}`);
  if (before !== undefined && after !== undefined && before >= after)
    throw new Error(`Block positions out of order: ${before} >= ${after}`);
  let key = '';
  for (let index = 0; ; index++) {
    const low = before === undefined ? 0 : digit(before, index);
    // Past the point where `key` already sorts below `after`, there is no upper bound.
    const high = after === undefined || !after.startsWith(key) ? BASE : digit(after, index);
    if (high - low > 1) {
      // Room at this digit: the midpoint, which is never the smallest digit.
      return key + DIGITS[Math.floor((low + high) / 2)]!;
    }
    key += DIGITS[low]!;
  }
}

/** `count` keys in order, all between `before` and `after`, for a batch of new or moved blocks. */
export function posRun(count: number, before?: string, after?: string): string[] {
  const keys: string[] = [];
  let previous = before;
  for (let index = 0; index < count; index++) {
    const next = posBetween(previous, after);
    keys.push(next);
    previous = next;
  }
  return keys;
}
