import '@tmt/browser-ui/work.css';
import type { BrowserSegmentState } from '@tmt/browser-ui/react';
import { SECTIONS, SECTION_TITLE, type SectionState, type SectionSummary } from './bootstrap.js';
import type { BlockRecord } from './block-model.js';
import { text } from './strings.js';

/** How a counted section draws (#6619): one of four marks, its tone, and its count with the state
 * word when the state is more than the count says. */
export interface SectionMarkView {
  shape: 'dot' | 'half' | 'target' | 'ring' | 'unknown';
  tone?: 'working' | 'waiting' | 'blocked' | 'muted';
  /** "3/5", "0/3 · Needs you", or the word alone for a section without to-dos. */
  count: string;
  /** The state word, for an accessible name. */
  word: string;
  /** The count alone ("0/3"), or the word for a section without to-dos. */
  short: string;
}

const t = text.sections;

export function sectionWord(state: SectionState): string {
  return t.state[state];
}

export function sectionMark(section: SectionSummary): SectionMarkView {
  const { state } = section;
  const word = sectionWord(state);
  const shape =
    state === 'done'
      ? 'dot'
      : state === 'needs-you' || state === 'blocked'
        ? 'target'
        : state === 'not-started'
          ? 'ring'
          : state === 'unchecked'
            ? 'unknown'
            : 'half';
  const tone =
    state === 'blocked'
      ? 'blocked'
      : state === 'needs-you'
        ? 'waiting'
        : state === 'not-started' || state === 'unchecked'
          ? 'muted'
          : undefined;
  // The count says done, in progress and not started by itself; other states add their word.
  const plain = state === 'done' || state === 'working' || state === 'not-started';
  // A heading marked done by hand says Done until its to-dos agree (#6687), never "0/3" beside a
  // done mark.
  const handDone = section.manual === 'done' && section.done < section.total;
  const count =
    section.total === 0 || handDone
      ? word
      : plain
        ? t.count(section.done, section.total)
        : `${t.count(section.done, section.total)} · ${word}`;
  const short = section.total === 0 || handDone ? word : t.count(section.done, section.total);
  return { shape, ...(tone ? { tone } : {}), count, word, short };
}

/** An HTML page's sections on the outline the frame measured (#6619): the owner reads the source,
 * the frame lists only visible headings, so each section takes the next heading with its level and
 * title, and one the frame does not show is left out. */
export function htmlOutlineSections(
  sections: readonly SectionSummary[],
  headings: readonly { id: string; title: string; level: number }[],
): SectionSummary[] {
  const out: SectionSummary[] = [];
  let next = 0;
  for (const section of sections) {
    const at = headings.findIndex(
      (heading, index) =>
        index >= next && heading.level === section.level && heading.title === section.title,
    );
    if (at < 0) continue;
    out.push({ ...section, id: headings[at]!.id });
    next = at + 1;
  }
  return out;
}

/** Done sections over counted sections, the page's one section number. */
export function sectionTotals(sections: readonly SectionSummary[]) {
  return {
    done: sections.filter((section) => section.state === 'done').length,
    total: sections.length,
  };
}

export function segmentState(state: SectionState): BrowserSegmentState {
  if (state === 'done') return 'done';
  if (state === 'blocked') return 'blocked';
  if (state === 'needs-you') return 'waiting';
  if (state === 'not-started' || state === 'unchecked') return 'todo';
  return 'working';
}

/** The section a status detail names: the first one waiting on a person or blocked. */
export function stuckSection(sections: readonly SectionSummary[]) {
  return sections.find((section) => section.state === 'needs-you' || section.state === 'blocked');
}

/** A GitHub pull request URL, as `PullLink::parse` in `work_facts.rs` accepts it. */
const PULL =
  /^https:\/\/github\.com\/[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}\/pull\/[1-9][0-9]*$/;
/** The candidate URLs a text holds, as `text_urls` and the link marks give them. */
function pullLinks(
  text: string | undefined,
  marks: readonly { mark: string; value?: string }[] = [],
) {
  const candidates = marks.flatMap((mark) =>
    mark.mark === 'link' && mark.value ? [mark.value] : [],
  );
  for (const tail of (text ?? '').split('https://github.com/').slice(1))
    candidates.push(
      `https://github.com/${/^[A-Za-z0-9/_.-]{0,320}/.exec(tail)![0].replace(/\.+$/, '')}`,
    );
  return candidates
    .map((url) => url.split(/[?#]/)[0]!.replace(/\/+$/, ''))
    .filter((url) => PULL.test(url));
}

/** A section title cut at 256 UTF-8 bytes on a character boundary, as `cut` in `sections.rs`. */
function cutTitle(title: string) {
  const bytes = new TextEncoder().encode(title);
  if (bytes.length <= SECTION_TITLE) return title;
  let end = SECTION_TITLE;
  // A continuation byte is not a character boundary.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/**
 * An open structured page's sections from its blocks in document order (#6687), so a to-do checked or a
 * heading marked done shows at once, here and in another browser, without waiting for the serve's
 * facts. The shape follows `sections.rs`: each heading with what follows it up to the next heading
 * of its level or higher, counted when it holds a to-do, a pull request link or a waiting question,
 * unless the heading says otherwise. A section with no pull request takes its state from the blocks
 * alone; one with a link keeps the state the serve's facts gave it, which needs GitHub.
 */
export function liveSections(
  blocks: readonly BlockRecord[],
  served: readonly SectionSummary[] | undefined,
): SectionSummary[] {
  interface Open {
    id: string;
    title: string;
    level: number;
    done: number;
    total: number;
    questions: number;
    blocked: boolean;
    pulls: Set<string>;
    manual?: 'done' | 'off';
  }
  const found: Open[] = [];
  const open: Open[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      const level = typeof block.props.level === 'number' ? block.props.level : 2;
      while (open.length && open.at(-1)!.level >= level) open.pop();
      const progress = block.props.progress;
      const section: Open = {
        id: block.id,
        title: cutTitle(block.text ?? ''),
        level,
        done: 0,
        total: 0,
        questions: 0,
        blocked: false,
        pulls: new Set(),
        ...(progress === 'done' || progress === 'off' ? { manual: progress } : {}),
      };
      found.push(section);
      open.push(section);
      continue;
    }
    const links = [
      ...pullLinks(block.text, block.marks),
      ...Object.values(block.cells ?? {}).flatMap((cell) => pullLinks(cell)),
    ];
    for (const section of open) {
      if (block.type === 'todo') {
        section.total += 1;
        if (block.props.checked === true) section.done += 1;
      } else if (block.type === 'question' && block.props.state === 'waiting')
        section.questions += 1;
      else if (block.type === 'callout' && block.props.tone === 'blocked') section.blocked = true;
      for (const link of links) section.pulls.add(link);
    }
  }
  const byId = new Map((served ?? []).map((section) => [section.id, section]));
  return found
    .filter((section) =>
      section.manual === 'off'
        ? false
        : section.manual === 'done' ||
          section.total > 0 ||
          section.pulls.size > 0 ||
          section.questions > 0,
    )
    .slice(0, SECTIONS)
    .map((section): SectionSummary => {
      const complete = section.total > 0 && section.done === section.total;
      const served = byId.get(section.id)?.state;
      const byTodos: SectionState = complete
        ? 'done'
        : section.done > 0
          ? 'working'
          : 'not-started';
      // A section with a pull request (`computed_state`): done needs its facts (released), so the
      // serve's word stands while the to-dos still agree. Open to-dos make a blocked callout or a
      // waiting question decide whatever the facts; otherwise the facts' waiting states stand, and
      // past those (closed PRs) the to-dos decide. Facts that no longer fit the blocks, or none yet,
      // are unchecked until the serve reads again (`folded_state` without facts).
      const todosComplete = section.done === section.total;
      const withPulls: SectionState =
        served === 'done' && todosComplete
          ? 'done'
          : !todosComplete && section.blocked
            ? 'blocked'
            : !todosComplete && section.questions > 0
              ? 'needs-you'
              : served === 'waiting-ci' || served === 'waiting-release' || served === 'unchecked'
                ? served
                : served === 'working' || served === 'not-started'
                  ? byTodos
                  : 'unchecked';
      const state: SectionState =
        section.manual === 'done'
          ? 'done'
          : section.pulls.size > 0
            ? withPulls
            : complete
              ? 'done'
              : section.blocked
                ? 'blocked'
                : section.questions > 0
                  ? 'needs-you'
                  : byTodos;
      return {
        id: section.id,
        title: section.title,
        level: section.level,
        done: section.done,
        total: section.total,
        state,
        ...(section.manual === 'done' ? { manual: 'done' as const } : {}),
      };
    });
}
