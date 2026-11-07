/**
 * `merge(base, remote, local)` for one block's whole-text replacement (#6004). The agent read
 * `base`, wrote `local`, and the page has moved on to `remote`; the agent's hunks (base → local)
 * are applied to the current text so concurrent typing outside them stays. The base only locates
 * hunks and never refuses a write.
 *
 * This mirrors the native `blocks::merge` and both run `contracts/vectors/block-text-merge-v1.json`.
 * Units are Unicode scalar values: offsets in hunks and in the dropped report count them, not
 * UTF-16 code units.
 */

/** The edit distance, after the common prefix and suffix, above which a diff is one hunk. */
export const DIFF_LIMIT = 1024;

/** A replacement of `base[from..to]` (in scalar values) by `text`; an insertion has `from === to`. */
export type Hunk = { from: number; to: number; text: string };
/** An agent hunk that overlapped a concurrent edit; the page keeps the other writer's text. */
export type Dropped = Hunk;
export type Merged = { text: string; dropped: Dropped[] };

const NEG = -0x80000000;
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/**
 * The predecessor of diagonal `k`: the furthest `x` and whether the last step was an insertion.
 * Cells outside the grid are unreachable. A tie in `x` prefers the deletion.
 */
function pick(
  prev: (j: number) => number,
  k: number,
  n: number,
  m: number,
): [number, boolean] | undefined {
  const down = prev(k + 1);
  const right = prev(k - 1);
  const downOk = down !== NEG && down - k <= m;
  const rightOk = right !== NEG && right < n;
  if (rightOk && downOk) return right + 1 >= down ? [right + 1, false] : [down, true];
  if (downOk) return [down, true];
  if (rightOk) return [right + 1, false];
  return undefined;
}

/** Myers' O(ND) script for `a → b`, or `undefined` when the distance exceeds `DIFF_LIMIT`. */
function script(a: string[], b: string[]): number[] | undefined {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, DIFF_LIMIT);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3).fill(NEG);
  v[1 + off] = 0;
  const trace: Int32Array[] = [];
  let last = -1;
  rounds: for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const picked = pick((j) => v[j + off]!, k, n, m);
      if (!picked) {
        v[k + off] = NEG;
        continue;
      }
      let x = picked[0];
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + off] = x;
      if (x === n && y === m) {
        last = d;
        break rounds;
      }
    }
  }
  if (last < 0) return undefined;
  let x = n;
  let y = m;
  const ops: number[] = [];
  for (let d = last; d >= 1; d--) {
    const snap = trace[d]!;
    const picked = pick((j) => snap[j + d + 1]!, x - y, n, m);
    if (!picked) return undefined;
    const down = picked[1];
    const px = down ? picked[0] : picked[0] - 1;
    const py = down ? picked[0] - (x - y + 1) : picked[0] - 1 - (x - y - 1);
    while (x > px + (down ? 0 : 1) && y > py + (down ? 1 : 0)) {
      x--;
      y--;
      ops.push(KEEP);
    }
    if (down) {
      y--;
      ops.push(INSERT);
    } else {
      x--;
      ops.push(DELETE);
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push(KEEP);
  }
  return ops.reverse();
}

/**
 * The hunks that turn `a` into `b`: the common prefix and suffix are kept, the middle is diffed
 * with Myers' algorithm, and each maximal run of changes between kept characters is one hunk.
 * Beyond `DIFF_LIMIT` the whole middle is one hunk.
 */
export function hunks(a: string[], b: string[]): Hunk[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const ma = a.slice(prefix, a.length - suffix);
  const mb = b.slice(prefix, b.length - suffix);
  if (ma.length === 0 && mb.length === 0) return [];
  const ops = script(ma, mb);
  if (!ops) return [{ from: prefix, to: prefix + ma.length, text: mb.join('') }];
  const out: Hunk[] = [];
  let open: { from: number; to: number; text: string[] } | undefined;
  let ai = 0;
  let bi = 0;
  const close = () => {
    if (open) out.push({ from: open.from, to: open.to, text: open.text.join('') });
    open = undefined;
  };
  for (const op of ops) {
    if (op === KEEP) {
      close();
      ai++;
      bi++;
      continue;
    }
    open ??= { from: prefix + ai, to: prefix + ai, text: [] };
    if (op === DELETE) {
      open.to++;
      ai++;
    } else {
      open.text.push(mb[bi]!);
      bi++;
    }
  }
  close();
  return out;
}

/** Their deleted ranges overlap, or one inserts strictly inside what the other deletes. */
const conflicts = (remote: Hunk, local: Hunk) => remote.from < local.to && local.from < remote.to;
const same = (x: Hunk, y: Hunk) => x.from === y.from && x.to === y.to && x.text === y.text;

/**
 * What happens to an agent hunk that overlaps a concurrent edit. `remote` (the default) keeps the
 * page's text and drops the whole hunk, which is reported: an agent rereads. `both` keeps the
 * hunk's new text right after the page's own text there and drops only its deletion (reported); a
 * person's typing is never lost. A hunk that only deletes is dropped whole.
 */
export type Overlap = 'remote' | 'both';

/**
 * Apply the agent's hunks (`base → local`) to the current text. Hunks that overlap a concurrent
 * edit are dropped and reported; a hunk the other writer also made is absorbed; insertions at one
 * point keep the other writer's first.
 */
export function merge(
  base: string,
  remote: string,
  local: string,
  overlap: Overlap = 'remote',
): Merged {
  const baseUnits = Array.from(base);
  const remoteHunks = hunks(baseUnits, Array.from(remote));
  const localHunks = hunks(baseUnits, Array.from(local));
  const accepted: [Hunk, number][] = remoteHunks.map((hunk) => [hunk, 0]);
  const dropped: Dropped[] = [];
  for (const hunk of localHunks) {
    if (remoteHunks.some((other) => same(other, hunk))) continue;
    const over = remoteHunks.filter((other) => conflicts(other, hunk));
    if (over.length === 0) {
      accepted.push([hunk, 1]);
    } else if (overlap === 'both' && hunk.text !== '') {
      // The typed text lands after the page's own text where it overlapped.
      const at = Math.max(...over.map((other) => other.to));
      accepted.push([{ from: at, to: at, text: hunk.text }, 1]);
      if (hunk.from < hunk.to) dropped.push({ from: hunk.from, to: hunk.to, text: '' });
    } else {
      dropped.push({ ...hunk });
    }
  }
  accepted.sort(([x, xs], [y, ys]) => x.from - y.from || x.to - y.to || xs - ys);
  let text = '';
  let cursor = 0;
  for (const [hunk] of accepted) {
    text += baseUnits.slice(cursor, hunk.from).join('') + hunk.text;
    cursor = hunk.to;
  }
  text += baseUnits.slice(cursor).join('');
  return { text, dropped };
}
