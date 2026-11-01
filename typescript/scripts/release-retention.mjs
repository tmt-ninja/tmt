// Plans one-week alpha retention (#3663) without mutation. This module has no write interface:
// it reads the bounded catalogue and local Git, and prints which release records a later live
// mode could delete. Tags are never candidates; they keep reserving their versions.
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import {
  isProductReleased,
  productOfComponent,
  productOfTag,
  upgradeSupportFloor,
} from './native-release-policy.mjs';
import { releaseCutHistory } from './release-cut.mjs';
import { readReleaseCatalog } from './release-cut-read.mjs';
import {
  declarationSource,
  declaresMinimumCli,
  gitDeclarationAncestry,
  readDeclarationMarker,
  readDeclarationReleases,
  resolveDeclaration,
} from './release-declaration.mjs';
import { selectPrevious } from './release-upgrade.mjs';
import {
  compareVersions,
  isAlphaVersion,
  isMinimumReleaseVersion,
  publishedReleases,
  versionOfTag,
} from './release-versions.mjs';
import { runPackedCommand } from './packed-command.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHA = /^[a-f0-9]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export const RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;
const VISIBILITY = new Set(['trusted', 'public']);
// Reviewed tag prefixes of products removed from the policy registry. Their releases are kept
// and never candidates; any other unknown prefix still refuses the whole plan.
const RETIRED_TAG_PREFIXES = {
  // Office was retired in #3003 (40452a2be8); Infra keeps its three published alphas.
  'tmt-office-v': 'office',
};
const retiredProductOfTag = (tag) => {
  const prefix = Object.keys(RETIRED_TAG_PREFIXES).find(
    (candidate) => tag.startsWith(candidate) && /^\d/.test(tag.slice(candidate.length))
  );
  return prefix && { product: RETIRED_TAG_PREFIXES[prefix], version: tag.slice(prefix.length) };
};

const draftState = (release) => {
  const names = new Set(release.assets.map(({ name }) => name));
  if (names.has('verification-failed.json')) return 'failed';
  return names.has('publication-held.json') ? 'held' : 'live';
};

/** Read-only Git answers do not change within one plan; reuse them for the after-deletion pass. */
function cachedGit(git) {
  const cache = new Map();
  return (args) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) {
      try {
        cache.set(key, { value: git(args) });
      } catch (error) {
        cache.set(key, { error });
      }
    }
    const entry = cache.get(key);
    if (entry.error) throw entry.error;
    return entry.value;
  };
}

/** Every row must name one known product and version; any doubt refuses the whole plan. */
function catalogueRows(releases) {
  if (!Array.isArray(releases)) throw new Error('Retention needs the complete release catalogue.');
  const ids = new Set();
  const tags = new Set();
  return releases.map((release) => {
    if (!Number.isSafeInteger(release?.id) || ids.has(release.id))
      throw new Error('Missing or duplicate release identity.');
    if (typeof release.tag_name !== 'string' || tags.has(release.tag_name))
      throw new Error(`Missing or duplicate release tag ${release.tag_name}.`);
    if (typeof release.draft !== 'boolean' || !Array.isArray(release.assets))
      throw new Error(`Invalid release metadata for ${release.tag_name}.`);
    ids.add(release.id);
    tags.add(release.tag_name);
    const registered = productOfTag(release.tag_name);
    const retired = !registered && retiredProductOfTag(release.tag_name);
    if (!registered && !retired)
      throw new Error(`Unknown release product for ${release.tag_name}.`);
    const product = registered ?? retired.product;
    const version = registered ? versionOfTag(release.tag_name, product) : retired.version;
    if (!isMinimumReleaseVersion(version))
      throw new Error(`Ambiguous release version ${release.tag_name}.`);
    const publishedAt = release.draft ? null : Date.parse(release.published_at ?? '');
    if (!release.draft && !(ISO.test(release.published_at ?? '') && Number.isFinite(publishedAt)))
      throw new Error(`Missing publication time for ${release.tag_name}.`);
    // Malformed or duplicate frozen declaration metadata throws here.
    const marker = readDeclarationMarker(release.body ?? '');
    if (marker && marker.product !== product)
      throw new Error(`Frozen declaration product differs from ${release.tag_name}.`);
    return { release, product, version, publishedAt, marker, retired: Boolean(retired) };
  });
}

/**
 * Candidates are published alpha versions (CLI alphas carry prerelease=false, so the version
 * decides) published before the frozen cutoff. Every selector the cut, declaration and
 * upgrade gates use is evaluated once on the full catalogue; what it returns is protected, and
 * each selector must return the identical result after the deletions (tags retained).
 */
export function planRetention({ releases, map, cut, git, cutoff, draftVisibility }) {
  if (!SHA.test(cut ?? '')) throw new Error('Retention needs an exact main cut SHA.');
  if (!ISO.test(cutoff ?? '') || !Number.isFinite(Date.parse(cutoff)))
    throw new Error('Retention needs an ISO-8601 UTC cutoff.');
  if (!VISIBILITY.has(draftVisibility))
    throw new Error('Draft visibility must be trusted or public.');
  const rows = catalogueRows(releases);
  const cutoffMs = Date.parse(cutoff);
  const readGit = cachedGit(git);
  const byTag = new Map(rows.map((row) => [row.release.tag_name, row]));
  const reasons = new Map(rows.map((row) => [row.release.id, new Set()]));
  const protect = (tag, reason) => {
    const row = byTag.get(tag);
    if (!row) throw new Error(`Unresolved retention reference ${tag} (${reason}).`);
    const before = reasons.get(row.release.id).size;
    reasons.get(row.release.id).add(reason);
    return reasons.get(row.release.id).size !== before;
  };
  const candidate = (row) =>
    !row.retired && !row.release.draft && isAlphaVersion(row.version) && row.publishedAt < cutoffMs;

  for (const row of rows) {
    if (row.retired) protect(row.release.tag_name, 'retired-product');
    else if (row.release.draft) protect(row.release.tag_name, `${draftState(row.release)}-draft`);
    else if (!isAlphaVersion(row.version)) protect(row.release.tag_name, 'not-alpha');
  }
  for (const product of new Set(rows.filter((row) => !row.retired).map((row) => row.product))) {
    const [newest] = publishedReleases(releases, product);
    if (newest) protect(newest.tag_name, 'newest-published');
    const floor = upgradeSupportFloor(product);
    if (floor && byTag.get(floor)?.release.draft === false) protect(floor, 'upgrade-support-floor');
  }
  // The immutability gate reads the repository's newest publication by time.
  const published = rows.filter((row) => !row.release.draft);
  const latestMs = Math.max(...published.map((row) => row.publishedAt));
  for (const row of published)
    if (row.publishedAt === latestMs) protect(row.release.tag_name, 'newest-publication');
  for (const row of rows)
    if (!row.release.draft && row.release.target_commitish === cut)
      protect(row.release.tag_name, 'main-cut-target');

  // Allowed cut targets: main for every released product, and each draft's own captured commit,
  // which its migration gate and upgrade proof re-read on retry, hold release or rerun.
  const cutProducts = [];
  for (const component of map.components) {
    if (component.release === false || !component.package) continue;
    const product = productOfComponent(component.name);
    if (isProductReleased(map, product)) cutProducts.push(product);
  }
  const targets = cutProducts.map((product) => ({ product, cut, excludeTag: '' }));
  for (const row of rows)
    if (
      row.release.draft &&
      cutProducts.includes(row.product) &&
      SHA.test(row.release.target_commitish ?? '')
    )
      targets.push({
        product: row.product,
        cut: row.release.target_commitish,
        excludeTag: row.release.tag_name,
      });
  const observeCli = gitDeclarationAncestry(readGit);
  const selectors = [];
  const select = (label, read, protectResult) => {
    const result = read(releases);
    selectors.push({ label, read, result });
    protectResult(result);
  };
  for (const target of targets) {
    const where = `${target.product}@${target.cut}${target.excludeTag ? ` for ${target.excludeTag}` : ''}`;
    select(
      `cut history ${where}`,
      (catalogue) => releaseCutHistory({ ...target, releases: catalogue, map, git: readGit }),
      (history) => {
        if (history.previous) protect(history.previous.tag, `published-boundary ${where}`);
        if (history.previousAllocated)
          protect(history.previousAllocated.tag, `allocated-boundary ${where}`);
      }
    );
  }
  for (const product of cutProducts.filter(declaresMinimumCli)) {
    select(
      `declaration ${product}`,
      (catalogue) => resolveDeclaration({ map, product, cut, releases: catalogue, observeCli }),
      (record) => {
        protect(record.cli.tag, `declaration-floor ${product}`);
        readDeclarationReleases({
          record,
          map,
          product,
          cut,
          readRelease: (tag) => {
            if (tag !== record.cli.tag) protect(tag, `extension-use ${product}`);
            return byTag.get(tag)?.release ?? null;
          },
        });
      }
    );
  }
  for (const row of rows)
    if (row.release.draft && cutProducts.includes(row.product))
      select(
        `upgrade previous ${row.release.tag_name}`,
        (catalogue) =>
          selectPrevious({
            releases: catalogue,
            product: row.product,
            candidateTag: row.release.tag_name,
          })?.tag_name ?? null,
        (tag) => tag && protect(tag, `upgrade-previous ${row.release.tag_name}`)
      );

  // A frozen declaration stays valid only while its CLI and uses remain published. Only kept
  // releases keep their markers, so repeat until no kept marker adds a protection.
  const deleted = (row) => candidate(row) && reasons.get(row.release.id).size === 0;
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) {
      if (!row.marker || deleted(row)) continue;
      readDeclarationReleases({
        record: row.marker,
        map,
        product: row.product,
        cut: row.marker.cut,
        readRelease: (tag) => {
          const reason =
            tag === row.marker.cli.tag
              ? `frozen-declaration ${row.release.tag_name}`
              : `extension-use ${row.release.tag_name}`;
          if (protect(tag, reason)) changed = true;
          return byTag.get(tag).release;
        },
      });
    }
  }

  const deletions = rows.filter(deleted);
  const removed = new Set(deletions.map((row) => row.release.id));
  const after = releases.filter((release) => !removed.has(release.id));
  for (const { label, read, result } of selectors)
    if (!isDeepStrictEqual(read(after), result))
      throw new Error(`Retention would change the ${label} selection.`);

  const order = (left, right) =>
    left.product.localeCompare(right.product) || compareVersions(right.version, left.version);
  const entry = (row) => ({
    id: row.release.id,
    tag: row.release.tag_name,
    product: row.product,
    published_at: row.release.draft ? null : row.release.published_at,
  });
  const kept = rows.filter((row) => reasons.get(row.release.id).size);
  return {
    schema: 1,
    mode: 'dry-run',
    status: draftVisibility === 'trusted' ? 'planned' : 'advisory',
    ...(draftVisibility === 'public'
      ? {
          advisory:
            'Drafts are invisible to a contents:read token, so draft-derived protections are missing. Only a trusted-visibility plan may drive deletion.',
        }
      : {}),
    cut,
    cutoff,
    retentionDays: RETENTION_DAYS,
    draftVisibility,
    counts: {
      releases: rows.length,
      candidates: rows.filter(candidate).length,
      deletions: deletions.length,
      protected: kept.length,
    },
    deletions: deletions.sort(order).map(entry),
    protected: kept
      .sort(order)
      .map((row) => ({ ...entry(row), reasons: [...reasons.get(row.release.id)].sort() })),
  };
}

export function refusedRetentionPlan({ cut, cutoff, draftVisibility, reason }) {
  return {
    schema: 1,
    mode: 'dry-run',
    status: 'refused',
    reason,
    cut: cut ?? null,
    cutoff: cutoff ?? null,
    retentionDays: RETENTION_DAYS,
    draftVisibility: draftVisibility ?? null,
    counts: { releases: 0, candidates: 0, deletions: 0, protected: 0 },
    deletions: [],
    protected: [],
  };
}

export function renderRetentionSummary(plan) {
  const lines = [
    '## Alpha release retention (dry run)',
    '',
    `Status: **${plan.status}**. Deletes nothing; tags are never deleted.`,
    '',
    `Cut: \`${plan.cut}\`; cutoff: \`${plan.cutoff}\`; draft visibility: ${plan.draftVisibility}.`,
    '',
  ];
  if (plan.reason) lines.push(`Refused: ${plan.reason}`, '');
  if (plan.advisory) lines.push(`Advisory: ${plan.advisory}`, '');
  const { releases, candidates, deletions } = plan.counts;
  lines.push(
    `${releases} releases; ${candidates} published alphas older than the cutoff; ${deletions} planned deletions; ${plan.protected.length} protected.`,
    ''
  );
  const protectedCandidates = plan.protected.filter(
    (row) =>
      row.published_at &&
      Date.parse(row.published_at) < Date.parse(plan.cutoff) &&
      !row.reasons.includes('not-alpha')
  );
  if (protectedCandidates.length) {
    lines.push('Protected despite age:', '');
    for (const row of protectedCandidates)
      lines.push(`- \`${row.tag}\`: ${row.reasons.join('; ')}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = {};
  let plan;
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      options: {
        cutoff: { type: 'string' },
        cut: { type: 'string' },
        catalogue: { type: 'string' },
        'draft-visibility': { type: 'string' },
      },
    });
    if (positionals.length !== 1 || positionals[0] !== 'plan')
      throw new Error(
        'Usage: release-retention.mjs plan --draft-visibility <trusted|public> [--cutoff <iso>] [--cut <sha>] [--catalogue <file>] (read only)'
      );
    const git = (args) =>
      runPackedCommand('git', args, { cwd: ROOT, env: process.env, timeoutMs: 30_000 }).trimEnd();
    input = {
      draftVisibility: values['draft-visibility'],
      cutoff: values.cutoff ?? new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString(),
      cut: values.cut ?? git(['rev-parse', '--verify', 'HEAD^{commit}']),
    };
    const releases = values.catalogue
      ? JSON.parse(readFileSync(values.catalogue, 'utf8'))
      : readReleaseCatalog({
          repository: process.env.GITHUB_REPOSITORY,
          token: process.env.GH_TOKEN,
        });
    plan = planRetention({
      ...input,
      releases: Array.isArray(releases) ? releases : releases.releases,
      map: declarationSource(input.cut, ROOT),
      git,
    });
  } catch (error) {
    plan = refusedRetentionPlan({ ...input, reason: error.message });
  }
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderRetentionSummary(plan));
  if (plan.status === 'refused') process.exitCode = 1;
}
