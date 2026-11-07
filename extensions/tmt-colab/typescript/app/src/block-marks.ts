import { textMerge } from '@tmt/colab-client';
import type { BlockOp, TextMark } from './block-model.js';
import { type Mark, richFromRuns } from './blocks.js';

/** One character's marks: a flag mark as `true`, a valued mark as its value. */
type CharMarks = Partial<Record<TextMark, unknown>>;

const perChar = (text: string, marks: readonly Mark[] = []): CharMarks[] => {
  const chars: CharMarks[] = Array.from(text, () => ({}));
  for (const mark of marks)
    for (let at = mark.from; at < Math.min(mark.to, chars.length); at++)
      chars[at]![mark.mark] = mark.value ?? true;
  return chars;
};
// The fold's own canonical form: maximal runs, ordered as the serve projects them.
const canonical = (text: string, chars: CharMarks[]): Mark[] =>
  richFromRuns(Array.from(text, (insert, at) => ({ insert, attributes: chars[at] }))).marks;

/**
 * Marks on scalar offsets as the serve keeps them when a whole-text op turns `before` into `after`
 * (#6005): an unchanged character keeps its marks, a new one has none (`blocks::text::splice`).
 */
export function marksThrough(before: string, after: string, marks: readonly Mark[] = []): Mark[] {
  if (!marks.length || before === after) return [...marks];
  const chars = perChar(before, marks);
  for (const hunk of textMerge.hunks([...before], [...after]).reverse())
    chars.splice(hunk.from, hunk.to - hunk.from, ...Array.from(hunk.text, () => ({})));
  return canonical(after, chars);
}

/** `mark` set on scalar `from..to` (`value` `false` or `null` clears it), as a `format` op applies:
 * the range must be inside the text and not empty, or the serve refuses the batch. */
export function formatMarks(
  text: string,
  marks: readonly Mark[] = [],
  format: { from: number; to: number; mark: TextMark; value: unknown },
): Mark[] {
  const chars = perChar(text, marks);
  if (!(format.from < format.to && format.to <= chars.length))
    throw new Error(`${format.from}..${format.to} is outside the text`);
  for (let at = format.from; at < format.to; at++)
    if (format.value === false || format.value === null) delete chars[at]![format.mark];
    else chars[at]![format.mark] = format.value;
  return canonical(text, chars);
}

/** Whether every character of `from..to` carries `mark` (with `value`, when given). */
export function marked(
  marks: readonly Mark[] = [],
  from: number,
  to: number,
  mark: TextMark,
  value?: unknown,
): boolean {
  if (from >= to) return false;
  let at = from;
  for (const run of marks)
    if (
      run.mark === mark &&
      run.from <= at &&
      run.to > at &&
      (value === undefined || run.value === value)
    )
      at = run.to;
  return at >= to;
}

/**
 * The `format` ops that give typed characters the marks of the text they were typed into, as the
 * editor draws them (Lexical types into the text node at the caret): an insertion takes the marks
 * of the character before it (the first one at the start), a replacement those of the first
 * character it replaced. Offsets are in `after`, the text the op beside them sets.
 */
export function typedMarks(
  id: string,
  before: string,
  after: string,
  marks: readonly Mark[] = [],
): BlockOp[] {
  if (!marks.length) return [];
  const chars = perChar(before, marks);
  const ops: BlockOp[] = [];
  let shift = 0;
  for (const hunk of textMerge.hunks([...before], [...after])) {
    const added = [...hunk.text].length;
    const from = hunk.from + shift;
    shift += added - (hunk.to - hunk.from);
    if (!added) continue;
    const source = chars[hunk.to > hunk.from ? hunk.from : Math.max(0, hunk.from - 1)] ?? {};
    for (const [mark, value] of Object.entries(source) as [TextMark, unknown][])
      ops.push({ op: 'text', id, format: { from, to: from + added, mark, value } });
  }
  return ops;
}

/** `format` ops that set `marks` on `id`, each clipped to `from..to` and moved by `by`: the marks
 * of text that moves to another block (Enter's rest, Backspace's join). */
export function markOps(
  id: string,
  marks: readonly Mark[] = [],
  from: number,
  to: number,
  by: number,
): BlockOp[] {
  return marks
    .filter((run) => run.from < to && run.to > from)
    .map((run) => ({
      op: 'text',
      id,
      format: {
        from: Math.max(run.from, from) + by,
        to: Math.min(run.to, to) + by,
        mark: run.mark,
        value: run.value ?? true,
      },
    }));
}
