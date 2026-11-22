/**
 * Test-only stand-in for `digest-source.ts` in the shell harness: the product module with the
 * sample. `?seats=<n>` and `?one-provider` pick the sample's shape; `?savings=partial|mixed|unpriced|older|unavailable|long`
 * the state of what Digest saved.
 */
import { mockDocument, mockSavings, type MockShape } from '../src/digest-mock.js';
import { savingsFromAnswer, type DigestSource } from '../src/digest-source.js';
export { USAGE_RANGES, providerRecords } from '../src/digest-source.js';

export function sampleShape(search = location.search): MockShape {
  const params = new URLSearchParams(search);
  const seats = Number(params.get('seats'));
  return { ...(seats > 0 ? { seats } : {}), oneProvider: params.has('one-provider') };
}

const sampleSource: DigestSource = {
  async report(range) {
    const document = mockDocument(range, sampleShape());
    const allowance = mockDocument('7d', sampleShape());
    if (new URLSearchParams(location.search).has('stale-allowance'))
      for (const limit of allowance.limits) {
        limit.stale = true;
        limit.elapsedPercent = null;
        limit.paceDeltaPoints = null;
      }
    if (new URLSearchParams(location.search).has('missing-evidence')) {
      document.usage.seats = document.usage.seats.map((seat) => ({
        ...seat,
        coverage: { ...seat.coverage, complete: true, gap: false },
        series: seat.series.map((point) => ({ ...point, complete: true })),
      }));
      document.usage.unavailable = [
        {
          id: 'missing-seat',
          name: 'missing-seat',
          retired: false,
          reason: 'no_evidence',
          cause: 'not_sampled',
        },
        {
          id: 'idle-seat',
          name: 'idle-seat',
          retired: false,
          reason: 'no_evidence',
          cause: 'idle',
        },
      ];
      allowance.limits = [];
      document.limitsUnavailable = [{ line: 'claude', reason: 'not_sampled' }];
    }
    const count = Number(new URLSearchParams(location.search).get('providers'));
    for (let at = 1; at < count; at++)
      allowance.limits = [
        ...allowance.limits,
        { ...allowance.limits[0]!, provider: `sample-provider-${at}` },
      ];
    const saved = new URLSearchParams(location.search).get('savings');
    const savings =
      saved === 'unavailable'
        ? savingsFromAnswer(range, { state: 'unavailable', observedAtMs: 1, reason: 'read_failed' })
        : {
            range,
            document: mockSavings(
              range,
              saved === 'partial' || saved === 'mixed' || saved === 'unpriced' ? saved : 'whole',
            ),
          };
    // `?savings=long`: long member names and large figures, where the table and tiles break first.
    if (saved === 'long' && savings.document) {
      const keys = ['messages', 'deliveries', 'turnsSaved', 'measuredSaved'] as const;
      const { members, total } = savings.document;
      for (const [index, member] of members.entries()) {
        member.name = `${member.name}-reviewer-for-the-weekly-release-train-${index + 1}`;
        for (const key of keys) member[key] = member[key] === null ? null : member[key] * 4_321;
      }
      for (const key of keys) total[key] = total[key] === null ? null : total[key] * 4_321;
      if (total.avoidedCost.usdMicros !== null) total.avoidedCost.usdMicros *= 4_321;
    }
    // `?savings=older`: a Digest from before #6794 lists neither covered nor unpriced members.
    if (saved === 'older' && savings.document) {
      savings.document.total.avoidedCost.covered = null;
      savings.document.total.avoidedCost.unpriced = null;
    }
    return { range, sample: true, document, allowance, savings };
  },
};

export const createDigestSource = (): DigestSource => sampleSource;
