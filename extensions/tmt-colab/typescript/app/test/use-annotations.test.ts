import { expect, test } from 'vite-plus/test';
import { projectUnsentHighlights, type Annotation } from '../src/use-annotations.js';

const annotation = (key: string): Annotation => ({
  key,
  selector: { exact: key, prefix: '', suffix: '' },
  rectangle: { x: 0, y: 0, width: 1, height: 1 },
});

test('the 64-quote paint cap keeps failed first then oldest creation order without losing owners', () => {
  const annotations = Array.from({ length: 70 }, (_, i) => annotation(String(i)));
  const sending = new Set(annotations.map((item) => item.key));
  const failed = new Set(['69', '65']);
  const projected = projectUnsentHighlights(annotations, sending, failed, new Set());
  expect(projected).toHaveLength(64);
  expect(projected.slice(0, 2)).toEqual([
    { selector: annotations[65]!.selector, state: 'failed' },
    { selector: annotations[69]!.selector, state: 'failed' },
  ]);
  expect(projected.slice(2).map((item) => item.selector.exact)).toEqual(
    annotations.slice(0, 62).map((item) => item.key),
  );
  expect(annotations).toHaveLength(70);
  expect(sending.size).toBe(70);
  expect(failed.size).toBe(2);
});

test('only unrecorded first-comment sends project, and retry changes the failed paint', () => {
  const first = annotation('first');
  const reply = { ...annotation('reply'), thread: { writer: 'writer', id: 'thread' } };
  const blank = { ...annotation('blank'), selector: null };
  const recorded = annotation('recorded');
  const idle = annotation('idle');
  const all = [first, reply, blank, recorded, idle];
  const sending = new Set(['first', 'reply', 'blank', 'recorded']);
  expect(projectUnsentHighlights(all, sending, new Set(['first']), new Set(['recorded']))).toEqual([
    { selector: first.selector, state: 'failed' },
  ]);
  expect(projectUnsentHighlights(all, sending, new Set(), new Set(['recorded']))).toEqual([
    { selector: first.selector, state: 'sending' },
  ]);
  expect(projectUnsentHighlights([], sending, new Set(['first']), new Set())).toEqual([]);
});
