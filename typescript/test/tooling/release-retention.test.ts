import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { parseComponentMap } from '../../scripts/ci-scope.mjs';
import { releaseCutHistory } from '../../scripts/release-cut.mjs';
import { declarationMarker } from '../../scripts/release-declaration.mjs';
import {
  planRetention,
  refusedRetentionPlan,
  renderRetentionSummary,
  type RetentionRelease,
} from '../../scripts/release-retention.mjs';

// Linear fixture history: sha(a) is an ancestor of sha(b) exactly when a <= b.
const sha = (n: number) => n.toString(16).padStart(40, '0');
const CUT = sha(1000);
const NOW = Date.parse('2026-11-01T00:00:00Z');
const CUTOFF = new Date(NOW - 7 * 86_400_000).toISOString();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const cliMap = parseComponentMap(
  JSON.stringify({ components: { cli: { owns: ['rust'], package: 'tmt-cli' } } })
);
const map = parseComponentMap(
  JSON.stringify({
    components: {
      cli: { owns: ['rust'], package: 'tmt-cli' },
      ops: {
        owns: ['extensions/ops'],
        package: 'tmt-ops',
        requiresCliSha: sha(1),
        bootstrapSha: sha(1),
        initialVersion: '0.1.0-alpha.1',
      },
    },
  })
);

let nextId = 1;
const release = (
  tag: string,
  target: number,
  options: { age?: number; draft?: boolean; assets?: string[]; body?: string } = {}
): RetentionRelease => ({
  id: nextId++,
  tag_name: tag,
  draft: options.draft ?? false,
  published_at: options.draft ? null : daysAgo(options.age ?? 30),
  body: options.body ?? '',
  target_commitish: sha(target),
  assets: (options.assets ?? []).map((name) => ({ name })),
});

/** Tags of published releases exist; `support` names the commit containing every declaration floor. */
function fakeGit(
  tags: Record<string, number>,
  support = 0,
  ancestor = (left: number, right: number) => left <= right
) {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    if (args[0] === 'tag' && args[1] === '--list')
      return Object.keys(tags)
        .filter((tag) => tag.startsWith(args[2].slice(0, -1)))
        .join('\n');
    if (args[0] === 'tag' && args[1] === '--contains')
      return Object.keys(tags)
        .filter((tag) => tag.startsWith('v') && tags[tag] >= support)
        .join('\n');
    if (args[0] === 'for-each-ref')
      return Object.entries(tags)
        .map(([tag, n]) => `${tag}\t${sha(n)}\t\tcommit\t`)
        .join('\n');
    if (args[0] === 'rev-parse') {
      const tag = args
        .at(-1)!
        .replace(/^refs\/tags\//, '')
        .replace(/\^\{commit\}$/, '');
      if (!(tag in tags)) throw new Error(`missing tag ${tag}`, { cause: { status: 128 } });
      return sha(tags[tag]);
    }
    if (args[0] === 'merge-base') {
      if (ancestor(parseInt(args[2], 16), parseInt(args[3], 16))) return '';
      throw new Error('not ancestor', { cause: { status: 1 } });
    }
    throw new Error(`Unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}

const tagsOf = (releases: RetentionRelease[]) =>
  Object.fromEntries(
    releases
      .filter((row) => !row.draft)
      .map((row) => [row.tag_name, parseInt(row.target_commitish!, 16)])
  );

function plan(releases: RetentionRelease[], extraTags: Record<string, number> = {}) {
  const { git } = fakeGit({ ...tagsOf(releases), ...extraTags });
  return planRetention({
    releases,
    map: cliMap,
    cut: CUT,
    git,
    cutoff: CUTOFF,
    draftVisibility: 'trusted',
  });
}
const reasonsOf = (result: ReturnType<typeof plan>, tag: string) =>
  result.protected.find((row) => row.tag === tag)?.reasons ?? [];
const deleted = (result: ReturnType<typeof plan>) => result.deletions.map((row) => row.tag);

/** A long CLI line plus a short ops line whose oldest supporting CLI is v5.0.0-alpha.2. */
function catalogue() {
  return [
    ...Array.from({ length: 6 }, (_, i) =>
      release(`v5.0.0-alpha.${i + 1}`, i + 1, { age: 40 - i })
    ),
    release('tmt-ops-v0.1.0-alpha.1', 3, { age: 30 }),
    release('tmt-ops-v0.1.0-alpha.2', 4, { age: 20 }),
  ];
}

describe('seven-day candidates', () => {
  it('deletes only published alphas strictly older than the frozen cutoff', () => {
    const releases = [
      release('v5.0.0-alpha.1', 1, { age: 30 }),
      release('v5.0.0-alpha.2', 2),
      release('v5.0.0-alpha.3', 3),
      release('v5.0.0-alpha.4', 4),
      release('v5.0.0-alpha.5', 5),
      release('v5.0.0-alpha.6', 6),
    ];
    // Exactly at the cutoff is kept; one millisecond older is a candidate.
    releases[2].published_at = new Date(Date.parse(CUTOFF) - 1).toISOString();
    releases[3].published_at = CUTOFF;
    releases[4].published_at = daysAgo(1);
    const result = plan(releases);
    expect(deleted(result)).toEqual(['v5.0.0-alpha.3', 'v5.0.0-alpha.2', 'v5.0.0-alpha.1']);
    // alpha.6 is old too, but it is the newest publication of the product.
    expect(result.counts).toEqual({ releases: 6, candidates: 4, deletions: 3, protected: 2 });
    expect(reasonsOf(result, 'v5.0.0-alpha.6')).toContain(`allocated-boundary cli@${CUT}`);
    expect(reasonsOf(result, 'v5.0.0-alpha.5')).toEqual(['newest-publication']);
    expect(reasonsOf(result, 'v5.0.0-alpha.6')).toContain('newest-published');
    expect(result.deletions[0]).toEqual({
      id: releases[2].id,
      tag: 'v5.0.0-alpha.3',
      product: 'cli',
      published_at: releases[2].published_at,
    });
  });

  it('never selects drafts, stable or non-alpha prereleases, whatever their age', () => {
    const releases = [
      release('v5.0.0', 1, { age: 300 }),
      release('v5.1.0-rc.1', 2, { age: 200 }),
      release('v5.1.0-alpha.1', 3, { age: 100 }),
      release('v5.1.0-alpha.9', 7, { age: 2 }),
      release('v5.1.0-alpha.2', 4, { draft: true }),
      release('v5.1.0-alpha.3', 5, { draft: true, assets: ['publication-held.json'] }),
      release('v5.1.0-alpha.4', 6, { draft: true, assets: ['verification-failed.json'] }),
    ];
    const result = plan(releases);
    expect(reasonsOf(result, 'v5.0.0')).toContain('not-alpha');
    expect(reasonsOf(result, 'v5.1.0-rc.1')).toContain('not-alpha');
    expect(reasonsOf(result, 'v5.1.0-alpha.2')).toContain('live-draft');
    expect(reasonsOf(result, 'v5.1.0-alpha.3')).toContain('held-draft');
    expect(reasonsOf(result, 'v5.1.0-alpha.4')).toContain('failed-draft');
    expect(result.deletions.every((row) => /-alpha\./.test(row.tag))).toBe(true);
    expect(result.deletions.some((row) => releases.find((r) => r.id === row.id)!.draft)).toBe(
      false
    );
  });
});

describe('protections', () => {
  it('keeps each product newest publication and the repository newest publication', () => {
    const releases = [
      release('v5.0.0-alpha.1', 1, { age: 40 }),
      release('v5.0.0-alpha.2', 2, { age: 30 }),
      release('tmt-ops-v0.1.0-alpha.1', 3, { age: 35 }),
      release('tmt-ops-v0.1.0-alpha.2', 4, { age: 20 }),
    ];
    const result = plan(releases);
    expect(reasonsOf(result, 'v5.0.0-alpha.2')).toContain('newest-published');
    expect(reasonsOf(result, 'tmt-ops-v0.1.0-alpha.2')).toEqual(
      expect.arrayContaining(['newest-published', 'newest-publication'])
    );
    expect(deleted(result)).toEqual(['v5.0.0-alpha.1', 'tmt-ops-v0.1.0-alpha.1']);
  });

  it('keeps the cut published and allocated boundaries, including a draft-captured cut', () => {
    // alpha.5 is a newer version on a branch that is not an ancestor of main.
    const releases = [
      release('v5.0.0-alpha.1', 1),
      release('v5.0.0-alpha.2', 2),
      release('v5.0.0-alpha.3', 3),
      release('v5.0.0-alpha.5', 2000, { age: 25 }),
      release('v5.0.0-alpha.6', 4, { draft: true }),
    ];
    const result = plan(releases);
    expect(reasonsOf(result, 'v5.0.0-alpha.3')).toEqual(
      expect.arrayContaining([
        `published-boundary cli@${CUT}`,
        `published-boundary cli@${sha(4)} for v5.0.0-alpha.6`,
      ])
    );
    expect(reasonsOf(result, 'v5.0.0-alpha.6')).toContain(`allocated-boundary cli@${CUT}`);
    expect(reasonsOf(result, 'v5.0.0-alpha.5')).toEqual([
      'newest-publication',
      'newest-published',
      'upgrade-previous v5.0.0-alpha.6',
    ]);
    expect(deleted(result)).toEqual(['v5.0.0-alpha.2', 'v5.0.0-alpha.1']);
  });

  it('keeps the selected declaration floor, frozen draft and kept markers, and extension uses', () => {
    const releases = catalogue();
    const frozen = {
      schema: 1,
      cut: sha(5),
      product: 'ops',
      cli: { tag: 'v5.0.0-alpha.4', version: '5.0.0-alpha.4', sha: sha(4) },
    };
    releases.push(
      release('tmt-ops-v0.1.0-alpha.3', 5, { draft: true, body: declarationMarker(frozen) })
    );
    const { git } = fakeGit(tagsOf(releases), 2);
    const result = planRetention({
      releases,
      map,
      cut: CUT,
      git,
      cutoff: CUTOFF,
      draftVisibility: 'trusted',
    });
    expect(reasonsOf(result, 'v5.0.0-alpha.2')).toContain('declaration-floor ops');
    expect(reasonsOf(result, 'v5.0.0-alpha.4')).toContain(
      'frozen-declaration tmt-ops-v0.1.0-alpha.3'
    );
    expect(deleted(result)).toEqual([
      'v5.0.0-alpha.5',
      'v5.0.0-alpha.3',
      'v5.0.0-alpha.1',
      'tmt-ops-v0.1.0-alpha.1',
    ]);

    // A marker on a release that is itself deleted protects nothing; a kept one does.
    const chained = catalogue();
    chained[6].body = declarationMarker({ ...frozen, cut: sha(3) });
    chained[7].body = declarationMarker({
      ...frozen,
      cut: sha(4),
      cli: { tag: 'v5.0.0-alpha.3', version: '5.0.0-alpha.3', sha: sha(3) },
    });
    const chain = planRetention({
      releases: chained,
      map,
      cut: CUT,
      git: fakeGit(tagsOf(chained), 2).git,
      cutoff: CUTOFF,
      draftVisibility: 'trusted',
    });
    expect(deleted(chain)).toContain('v5.0.0-alpha.4');
    expect(reasonsOf(chain, 'v5.0.0-alpha.3')).toEqual([
      'frozen-declaration tmt-ops-v0.1.0-alpha.2',
    ]);

    const withUses = parseComponentMap(
      JSON.stringify({
        components: {
          cli: { owns: ['rust'], package: 'tmt-cli' },
          remote: { owns: ['extensions/remote'], package: 'tmt-remote', requiresCliSha: sha(1) },
          ops: {
            owns: ['extensions/ops'],
            package: 'tmt-ops',
            requiresCliSha: sha(1),
            uses: [
              {
                feature: 'browser-access',
                label: 'Browser access',
                extension: 'remote',
                requires: '>=0.1.0-alpha.1',
              },
            ],
          },
        },
      })
    );
    const used = [
      ...catalogue(),
      release('tmt-remote-v0.1.0-alpha.1', 3, { age: 30 }),
      release('tmt-remote-v0.1.0-alpha.2', 4, { age: 20 }),
    ];
    const uses = planRetention({
      releases: used,
      map: withUses,
      cut: CUT,
      git: fakeGit(tagsOf(used), 2).git,
      cutoff: CUTOFF,
      draftVisibility: 'trusted',
    });
    expect(reasonsOf(uses, 'tmt-remote-v0.1.0-alpha.1')).toEqual(['extension-use ops']);
  });

  it('keeps the CLI upgrade support floor and a release at the main cut', () => {
    const releases = [
      release('v5.0.0-alpha.150', 1),
      release('v5.0.0-alpha.151', 1000),
      release('v5.0.0-alpha.152', 1001, { age: 1 }),
    ];
    const result = plan(releases);
    expect(reasonsOf(result, 'v5.0.0-alpha.150')).toContain('upgrade-support-floor');
    expect(reasonsOf(result, 'v5.0.0-alpha.151')).toContain('main-cut-target');
    expect(result.deletions).toEqual([]);
  });
});

describe('fail-closed refusal', () => {
  it.each([
    [
      'an unknown product',
      (rows: RetentionRelease[]) => rows.push(release('tmt-office-v0.1.0-alpha.1', 1)),
    ],
    ['a duplicate tag', (rows: RetentionRelease[]) => rows.push({ ...rows[0], id: 999 })],
    [
      'a duplicate identity',
      (rows: RetentionRelease[]) => rows.push({ ...rows[1], tag_name: 'v9.0.0-alpha.1' }),
    ],
    ['a missing publication time', (rows: RetentionRelease[]) => (rows[0].published_at = null)],
    [
      'a malformed marker',
      (rows: RetentionRelease[]) => (rows[6].body = '<!-- tmt-release-cli: {} x -->'),
    ],
    [
      'a duplicate marker',
      (rows: RetentionRelease[]) =>
        (rows[6].body = `${declarationMarker({ schema: 1, cut: sha(3), product: 'ops', cli: { tag: 'v5.0.0-alpha.2', version: '5.0.0-alpha.2', sha: sha(2) } })}${declarationMarker({ schema: 1, cut: sha(3), product: 'ops', cli: { tag: 'v5.0.0-alpha.2', version: '5.0.0-alpha.2', sha: sha(2) } })}`),
    ],
    [
      'an unresolved frozen reference',
      (rows: RetentionRelease[]) =>
        (rows[7].body = declarationMarker({
          schema: 1,
          cut: sha(4),
          product: 'ops',
          cli: { tag: 'v5.0.0-alpha.77', version: '5.0.0-alpha.77', sha: sha(4) },
        })),
    ],
  ])('refuses the whole plan on %s', (_name, mutate) => {
    const releases = catalogue();
    const { git } = fakeGit(tagsOf(releases), 2);
    mutate(releases);
    expect(() =>
      planRetention({ releases, map, cut: CUT, git, cutoff: CUTOFF, draftVisibility: 'trusted' })
    ).toThrow();
  });

  it('refuses an absent catalogue', () => {
    expect(() =>
      planRetention({
        releases: null as unknown as RetentionRelease[],
        map,
        cut: CUT,
        git: fakeGit({}).git,
        cutoff: CUTOFF,
        draftVisibility: 'trusted',
      })
    ).toThrow('complete release catalogue');
  });

  it('refuses missing tag history, unknown visibility and a malformed cutoff', () => {
    const releases = catalogue();
    const { git } = fakeGit({}, 2);
    expect(() =>
      planRetention({ releases, map, cut: CUT, git, cutoff: CUTOFF, draftVisibility: 'trusted' })
    ).toThrow();
    const ok = fakeGit(tagsOf(releases), 2).git;
    const input = {
      releases,
      map,
      cut: CUT,
      git: ok,
      cutoff: CUTOFF,
      draftVisibility: 'trusted' as const,
    };
    expect(() => planRetention({ ...input, draftVisibility: 'none' as 'public' })).toThrow(
      'visibility'
    );
    expect(() => planRetention({ ...input, cutoff: '2026-10-25' })).toThrow('cutoff');
    expect(() => planRetention({ ...input, cut: 'main' })).toThrow('exact main cut');
  });

  it('reports a refusal with zero deletions and a nonzero-exit status', () => {
    const refused = refusedRetentionPlan({
      cut: CUT,
      cutoff: CUTOFF,
      draftVisibility: 'trusted',
      reason: 'Unknown release product for tmt-office-v0.1.0-alpha.1.',
    });
    expect(refused).toMatchObject({ status: 'refused', deletions: [], counts: { deletions: 0 } });
    expect(renderRetentionSummary(refused)).toContain('Refused: Unknown release product');
  });

  it('labels a public-visibility plan advisory', () => {
    const releases = catalogue();
    const result = planRetention({
      releases,
      map,
      cut: CUT,
      git: fakeGit(tagsOf(releases), 2).git,
      cutoff: CUTOFF,
      draftVisibility: 'public',
    });
    expect(result.status).toBe('advisory');
    expect(renderRetentionSummary(result)).toContain('Advisory: Drafts are invisible');
  });
});

describe('determinism', () => {
  it('returns the same plan for any catalogue order and reads Git only through queries', () => {
    const releases = catalogue();
    const first = plan(releases);
    const second = plan([...releases].reverse());
    expect(second).toEqual(first);
    const { git, calls } = fakeGit(tagsOf(releases), 2);
    planRetention({ releases, map, cut: CUT, git, cutoff: CUTOFF, draftVisibility: 'trusted' });
    expect(new Set(calls.map((args) => args[0]))).toEqual(
      new Set(['tag', 'for-each-ref', 'rev-parse', 'merge-base'])
    );
    expect(renderRetentionSummary(first)).toBe(renderRetentionSummary(second));
  });
});

// The six production-oracle controls of #3663 (c6553292670): each cut history must be identical
// before and after removing the planned deletions while every tag stays in place.
describe('cut selector oracle round trip', () => {
  const tag = (n: number) => `v5.0.0-alpha.${n}`;
  const row = (n: number, target: number, draft = false, failed = false, age = 30) =>
    release(tag(n), target, {
      draft,
      age,
      assets: failed ? ['verification-failed.json'] : [],
    });
  const cut = sha(4);
  const controls: [string, () => RetentionRelease[], Record<string, number>][] = [
    [
      'backfill defeats a tagged-ancestor prefix',
      () => [row(3, 1), row(2, 2, true), row(1, 0)],
      { [tag(3)]: 1, [tag(1)]: 0 },
    ],
    [
      'held tagless draft reserves and delimits',
      () => [row(900, 2, true), row(3, 1)],
      { [tag(3)]: 1 },
    ],
    [
      'failed tagless draft reserves without delimiting',
      () => [row(900, 2, true, true), row(3, 1)],
      { [tag(3)]: 1 },
    ],
    ['orphan tag reserves without publication', () => [row(3, 1)], { [tag(900)]: 2, [tag(3)]: 1 }],
    [
      'identical tags with publication membership',
      () => [row(900, 2), row(3, 1)],
      { [tag(900)]: 2, [tag(3)]: 1 },
    ],
    ['deleted tagless draft frees its version', () => [row(3, 1)], { [tag(3)]: 1 }],
  ];
  it.each(controls)('%s', (_name, build, tags) => {
    // Lower-version published padding gives every control real deletion candidates. The
    // newest publication sits on a branch outside the cut, so only the boundary rules protect
    // the control's own boundaries.
    const releases = [
      ...build(),
      release('v4.0.0-alpha.2', 0, { age: 60 }),
      release('v4.0.0-alpha.1', 0, { age: 70 }),
      row(950, 5000, false, false, 20),
    ];
    const allTags = {
      ...tags,
      'v4.0.0-alpha.2': 0,
      'v4.0.0-alpha.1': 0,
      [tag(950)]: 5000,
    };
    const { git } = fakeGit(allTags);
    const history = (catalogue: RetentionRelease[]) =>
      releaseCutHistory({ releases: catalogue, product: 'cli', cut, git, map: cliMap });
    const result = planRetention({
      releases,
      map: cliMap,
      cut,
      git,
      cutoff: CUTOFF,
      draftVisibility: 'trusted',
    });
    const removed = new Set(result.deletions.map((entry) => entry.id));
    const after = releases.filter((release) => !removed.has(release.id));
    expect(after.length).toBeLessThan(releases.length);
    expect(history(after)).toEqual(history(releases));
  });

  it('refuses with zero deletions when a branchy history would move the allocated boundary', () => {
    // a <- b <- d and a <- c; z is unrelated; every commit reaches the cut. Deleting the old,
    // unprotected alpha.90 at b lets draft alpha.80 at c replace the draft at a, so the final
    // allocated boundary moves from alpha.70 to alpha.80: the round trip must refuse.
    const [a, b, c, d, z, top] = [10, 11, 12, 13, 14, 99];
    const parents: Record<number, number[]> = { [b]: [a], [c]: [a], [d]: [b], [top]: [z, d, c] };
    const ancestor = (left: number, right: number): boolean =>
      left === right || (parents[right] ?? []).some((parent) => ancestor(left, parent));
    const releases = [
      release('v5.0.0-alpha.100', a, { draft: true }),
      release('v5.0.0-alpha.95', z, { age: 30 }),
      release('v5.0.0-alpha.90', b, { age: 40 }),
      release('v5.0.0-alpha.80', c, { draft: true }),
      release('v5.0.0-alpha.70', d, { age: 35 }),
    ];
    const { git } = fakeGit(tagsOf(releases), 0, ancestor);
    const input = {
      map: cliMap,
      cut: sha(top),
      git,
      cutoff: CUTOFF,
      draftVisibility: 'trusted' as const,
    };
    const before = releaseCutHistory({ releases, product: 'cli', cut: sha(top), git, map: cliMap });
    expect(before.previousAllocated).toEqual({ tag: 'v5.0.0-alpha.70', sha: sha(d) });
    expect(
      releaseCutHistory({
        releases: releases.filter((row) => row.tag_name !== 'v5.0.0-alpha.90'),
        product: 'cli',
        cut: sha(top),
        git,
        map: cliMap,
      }).previousAllocated
    ).toEqual({ tag: 'v5.0.0-alpha.80', sha: sha(c) });
    expect(() => planRetention({ ...input, releases })).toThrow(
      `Retention would change the cut history cli@${sha(top)} selection.`
    );
  });
});

describe('scheduled dry-run workflow', () => {
  const workflow = readFileSync(
    new URL('../../../.github/workflows/release-retention.yml', import.meta.url),
    'utf8'
  );
  it('runs only on main with read-only contents and no secret, Environment or write', () => {
    expect(workflow).toMatch(
      /^on:\n {2}schedule:\n {4}- cron: '[^']+'\n {2}workflow_dispatch:\n\n/m
    );
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(
      [...workflow.matchAll(/^\s+(\w[\w-]*): (read|write)$/gm)].map((m) => m[0].trim())
    ).toEqual(['contents: read']);
    expect(workflow).not.toMatch(/secrets\.|environment:|: write|gh (?:release|workflow|api)/);
    expect(workflow).toContain('release-retention.mjs plan --draft-visibility public');
    expect(workflow).toContain('name: release-retention-plan');
  });
});
