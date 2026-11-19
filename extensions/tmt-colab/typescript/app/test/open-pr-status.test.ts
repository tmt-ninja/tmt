import { expect, it } from 'vite-plus/test';
import { openPrStatus } from '../src/open-pr-status.js';
import type { WorkFactView } from '../src/reading-details.js';
type Pull = WorkFactView['pulls'][number];
function pull(
  id: number,
  checks: NonNullable<Pull['fact']>['checks'],
  state: NonNullable<Pull['fact']>['state'] = 'open',
): Pull {
  return {
    url: 'https://github.com/example/project/pull/' + id,
    fact: { state, checks, observedAtMs: 1, tag: null, released: null },
  };
}
it('names the open PR with the least advanced checks', () => {
  const passed = pull(1, 'SUCCESS');
  expect(openPrStatus([pull(2, 'FAILURE', 'closed'), passed])).toEqual({
    label: 'Waiting to merge',
    reason: 'PR #1 is open and its checks passed.',
  });
  for (const checks of ['PENDING', 'EXPECTED', null] as const) {
    const pending = pull(2, checks);
    expect(openPrStatus([passed, pending])).toEqual({
      label: 'Waiting for CI',
      reason: 'PR #2 is open.',
    });
    for (const failed of ['ERROR', 'FAILURE'] as const)
      expect(openPrStatus([pending, passed, pull(3, failed)])).toEqual({
        label: 'CI failed',
        reason: 'PR #3 has failed checks.',
      });
  }
  expect(openPrStatus().label).toBe('Waiting on a PR');
  expect(openPrStatus([]).label).toBe('Waiting for CI');
  expect(
    openPrStatus([passed, { url: 'https://github.com/example/project/pull/4', fact: null }]).label,
  ).toBe('Waiting for CI');
});
