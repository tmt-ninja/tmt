import { expect, it } from 'vite-plus/test';
import { needsYou, pageStage } from '../src/list-stage.js';
import type { PageSummary } from '../src/transport.js';

// The list shows a page's retained computed status (#6520); without one it keeps its stage.
const page = (summary?: Partial<NonNullable<PageSummary['summary']>>) =>
  ({
    id: 'p',
    summary: summary && { comments: 0, waiting: false, needsYou: 0, ...summary },
  }) as unknown as PageSummary;

it('maps every computed status to one list tab and keeps the stage without one', () => {
  const tab = (status: NonNullable<PageSummary['summary']>['status']) => {
    const shown = page({ status });
    return needsYou(shown) ? 'needs' : pageStage(shown);
  };
  expect((['needs-you', 'blocked'] as const).map(tab)).toEqual(['needs', 'needs']);
  expect(
    (['working', 'possibly-stalled', 'waiting-ci', 'waiting-release'] as const).map(tab),
  ).toEqual(Array(4).fill('in-progress'));
  expect(tab('done')).toBe('done');
  expect((['discussing', 'unknown', 'unchecked'] as const).map(tab)).toEqual([
    'discussion',
    'discussion',
    'discussion',
  ]);
  // No retained status: the sub-page stage stays, and a page not yet summarised is at none.
  expect(pageStage(page({ work: { stage: 'in-progress', done: 0, total: 1 } }))).toBe(
    'in-progress',
  );
  expect(pageStage(page({}))).toBe('discussion');
  expect(pageStage(page())).toBeUndefined();
});
