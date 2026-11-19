import type { WorkFactView } from './reading-details.js';
import { text } from './strings.js';

export function openPrStatus(pulls?: WorkFactView['pulls']) {
  const t = text.workBand;
  if (!pulls)
    return { label: t.computedState['waiting-ci'], reason: t.statusReason['waiting-ci']() };
  const open = pulls.filter((p) => p.fact?.state === 'open');
  const failed = open.find((p) => p.fact?.checks === 'ERROR' || p.fact?.checks === 'FAILURE');
  const pending = open.find((p) => p.fact?.checks !== 'SUCCESS');
  const deciding = failed ?? pending ?? open[0];
  const number = deciding?.url.split('/').at(-1);
  if (number && failed) return { label: t.checks.FAILURE, reason: t.openChecksFailed(number) };
  if (number && !pending && pulls.every((p) => p.fact))
    return { label: t.waitingToMerge, reason: t.openChecksPassed(number) };
  return {
    label: t.waitingForCi,
    reason: t.statusReason['waiting-ci'](pending ? number : undefined),
  };
}
