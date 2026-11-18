import '@tmt/browser-ui/work.css';
import type { BrowserSegmentState } from '@tmt/browser-ui/react';
import type { SectionState, SectionSummary } from './bootstrap.js';
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
  const count =
    section.total === 0
      ? word
      : plain
        ? t.count(section.done, section.total)
        : `${t.count(section.done, section.total)} · ${word}`;
  return { shape, ...(tone ? { tone } : {}), count, word };
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
