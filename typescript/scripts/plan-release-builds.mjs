#!/usr/bin/env node
// Classifies durable draft markers for build and publication decisions. Native release passes
// its exact allocated tag; owner retry, hold and rerun each select one existing draft.
//   gh api --paginate --slurp repos/OWNER/REPO/releases \
//     | node plan-release-builds.mjs --product cli [--tag TAG | --retry TAG | --hold TAG | --rerun TAG] [--components FILE]
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { readStdinUtf8 } from './read-stdin.mjs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseComponentMap } from './ci-scope.mjs';
import { isProductReleased, productOfTag } from './native-release-policy.mjs';

/** Uploaded last, after every verify job passed: a draft that has it carries a complete bundle. */
export const BUNDLE_ASSET = 'release-publication.json';
/** Uploaded when a job of a draft's pipeline failed: later runs skip the draft until a retry. */
export const FAILURE_ASSET = 'verification-failed.json';
/**
 * Uploaded when a publication gate failed for a complete bundle: which gate, why and which run. A
 * held draft is not published until the owner publishes it or releases the hold by dispatch.
 */
export const HOLD_ASSET = 'publication-held.json';

const COMMIT = /^[0-9a-f]{40}$/;
/** The component map of this repository, which decides what is released. */
const COMPONENTS = fileURLToPath(new URL('../../.github/components.json', import.meta.url));
const RELISTS = 5;
const RELIST_DELAY_MS = 3000;

const oldestFirst = (left, right) =>
  Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.tag.localeCompare(right.tag);

/**
 * `releases` are GitHub release objects. Returns the drafts of `product` to build, the complete
 * drafts that await their publication, the drafts that are parked and the drafts that are held,
 * each oldest first. A `retry` tag plans exactly that draft, ignoring its failure marker, and
 * refuses a tag that is not an unbundled draft of the product.
 */
export function planReleaseBuilds({
  releases,
  product,
  tag = '',
  retry = '',
  hold = '',
  rerun = '',
  released = true,
}) {
  if ([tag, retry, hold, rerun].filter(Boolean).length > 1) {
    throw new Error('tag, retry, hold and rerun are separate runs; give one of them.');
  }
  const drafts = releases.filter(
    (release) =>
      release.draft === true &&
      productOfTag(release.tag_name) === product &&
      (!tag || release.tag_name === tag)
  );
  if (tag && !drafts.length)
    throw new Error(`Cannot build ${tag}: it is not a draft release of the ${product} product.`);
  if (!released) {
    if (tag !== '' || retry !== '' || hold !== '' || rerun !== '') {
      throw new Error(`${product} is not released (release: false in .github/components.json).`);
    }
    return {
      builds: [],
      awaiting: [],
      blocked: [],
      held: [],
      unreleased: drafts.map((release) => ({ tag: release.tag_name })),
    };
  }
  const named = (release) => ({
    tag: release.tag_name,
    sha: release.target_commitish,
    createdAt: release.created_at,
  });
  const assetNames = (release) => new Set((release.assets ?? []).map(({ name }) => name));

  if (retry !== '') {
    const release = drafts.find(({ tag_name: tag }) => tag === retry);
    if (!release) {
      throw new Error(
        `Cannot retry ${retry}: it is not a draft release of the ${product} product.`
      );
    }
    if (assetNames(release).has(BUNDLE_ASSET)) {
      throw new Error(`Cannot retry ${retry}: it already carries a verified bundle.`);
    }
    if (!COMMIT.test(release.target_commitish)) {
      throw new Error(
        `Cannot retry ${retry}: its target ${release.target_commitish} is not a commit.`
      );
    }
    return { builds: [named(release)], awaiting: [], blocked: [], held: [] };
  }

  if (hold !== '' || rerun !== '') {
    const tag = hold || rerun;
    const action = rerun ? 'rerun the gates of' : 'release the hold of';
    const release = drafts.find(({ tag_name }) => tag_name === tag);
    if (!release) {
      throw new Error(
        `Cannot ${action} ${tag}: it is not a draft release of the ${product} product.`
      );
    }
    const assets = assetNames(release);
    if (!assets.has(BUNDLE_ASSET) || !assets.has(HOLD_ASSET)) {
      throw new Error(`Cannot ${action} ${tag}: it has no bundle held by ${HOLD_ASSET}.`);
    }
    if (!COMMIT.test(release.target_commitish)) {
      throw new Error(
        `Cannot ${action} ${tag}: its target ${release.target_commitish} is not a commit.`
      );
    }
    return { builds: [named(release)], awaiting: [], blocked: [], held: [] };
  }

  const builds = [];
  const awaiting = [];
  const blocked = [];
  const held = [];
  for (const release of drafts) {
    const assets = assetNames(release);
    if (assets.has(BUNDLE_ASSET)) {
      if (assets.has(HOLD_ASSET)) held.push({ tag: release.tag_name });
      else if (!COMMIT.test(release.target_commitish)) {
        blocked.push({
          tag: release.tag_name,
          reason: `its target ${release.target_commitish} is not a commit SHA, so the commit to publish is unknown`,
        });
      } else awaiting.push(named(release));
      continue;
    }
    if (!COMMIT.test(release.target_commitish)) {
      blocked.push({
        tag: release.tag_name,
        reason: `its target ${release.target_commitish} is not a commit SHA, so the commit to build is unknown`,
      });
    } else if (assets.has(FAILURE_ASSET)) {
      blocked.push({
        tag: release.tag_name,
        reason: 'its verification failed earlier; retry it by dispatch or delete the draft',
      });
    } else {
      builds.push(named(release));
    }
  }
  return {
    builds: builds.sort(oldestFirst),
    awaiting: awaiting.sort(oldestFirst),
    blocked,
    held: held.sort(oldestFirst),
  };
}

/** Markdown for the run summary. */
export function renderPlanSummary({
  product,
  builds,
  awaiting = [],
  blocked,
  held = [],
  unreleased = [],
  retry = '',
  hold = '',
  rerun = '',
}) {
  const lines = [`### Release run for ${product}`, ''];
  if (retry !== '') lines.push(`Retrying ${retry} by dispatch.`, '');
  if (hold !== '') lines.push(`Releasing the hold of ${hold} by dispatch.`, '');
  if (rerun !== '')
    lines.push(`Rerunning every gate of ${rerun} by owner-authorized dispatch.`, '');
  lines.push(
    builds.length === 0
      ? 'No draft release needs a build.'
      : `Drafts to build and verify, oldest first: ${builds.map(({ tag }) => `\`${tag}\``).join(', ')}.`
  );
  if (awaiting.length > 0) {
    lines.push(
      '',
      `Complete drafts that await their gates and publication, oldest first: ${awaiting.map(({ tag }) => `\`${tag}\``).join(', ')}.`
    );
  }
  if (unreleased.length > 0) {
    lines.push(
      '',
      `**Left alone** (${product} is not released, \`release: false\` in the component map):`
    );
    for (const { tag } of unreleased) lines.push(`- \`${tag}\``);
  }
  if (held.length > 0) {
    lines.push(
      '',
      `**Held drafts** (complete, not published; each carries \`${HOLD_ASSET}\` with the gate and the reason):`
    );
    for (const { tag } of held) lines.push(`- \`${tag}\``);
  }
  if (blocked.length > 0) {
    lines.push('', '**Parked drafts** (not built until retried by dispatch or deleted):');
    for (const { tag, reason } of blocked) lines.push(`- \`${tag}\`: ${reason}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The pages `gh api --paginate --slurp` prints, or a plain list of releases, as one list. */
export function releasesFrom(parsed) {
  return parsed.flat();
}

/** Re-read only when the requested tag is absent; known state and read errors go to the caller. */
function readAllocatedDraftList({ list, tag, sleep }) {
  const hasTag = (rows) => rows.some(({ tag_name }) => tag_name === tag);
  let releases = list();
  for (let read = 0; read < RELISTS && !hasTag(releases); read += 1) {
    sleep(RELIST_DELAY_MS);
    releases = list();
  }
  return { releases, missing: !hasTag(releases) };
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      product: { type: 'string' },
      tag: { type: 'string', default: '' },
      retry: { type: 'string', default: '' },
      hold: { type: 'string', default: '' },
      rerun: { type: 'string', default: '' },
      components: { type: 'string', default: COMPONENTS },
      github: { type: 'boolean' },
    },
  });
  if (!values.product) {
    throw new Error(
      'Usage: plan-release-builds.mjs --product <product> [--tag <tag> | --retry <tag> | --hold <tag> | --rerun <tag>]'
    );
  }
  const map = parseComponentMap(readFileSync(values.components, 'utf8'));
  const released = isProductReleased(map, values.product);
  let releases;
  if (values.github) {
    if (!values.tag || values.retry || values.hold || values.rerun || !released)
      throw new Error('--github requires one allocated tag of a released product.');
    if (productOfTag(values.tag) !== values.product)
      throw new Error(
        `Cannot build ${values.tag}: it is not a draft release of the ${values.product} product.`
      );
    const repository = process.env.GITHUB_REPOSITORY;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? ''))
      throw new Error('Allocated draft discovery needs a repository.');
    const pause = new Int32Array(new SharedArrayBuffer(4));
    const discovery = readAllocatedDraftList({
      tag: values.tag,
      sleep: (ms) => Atomics.wait(pause, 0, 0, ms),
      list: () => {
        const result = spawnSync(
          'gh',
          ['api', '--paginate', '--slurp', `repos/${repository}/releases`],
          { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 25_000, killSignal: 'SIGKILL' }
        );
        if (result.error) throw result.error;
        if (result.status !== 0)
          throw new Error(
            `Allocated draft catalogue read failed: ${result.stderr.split('\n', 1)[0]}`
          );
        const pages = JSON.parse(result.stdout);
        if (
          !Array.isArray(pages) ||
          pages.length === 0 ||
          pages.some((page) => !Array.isArray(page))
        )
          throw new Error('Invalid allocated draft catalogue.');
        const rows = releasesFrom(pages);
        if (rows.some((row) => typeof row?.tag_name !== 'string' || typeof row.draft !== 'boolean'))
          throw new Error('Invalid allocated draft catalogue record.');
        return rows;
      },
    });
    if (discovery.missing && process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, 'draft_missing=true\n');
    releases = discovery.releases;
  } else {
    releases = releasesFrom(JSON.parse(readStdinUtf8()));
  }
  const plan = planReleaseBuilds({
    releases,
    product: values.product,
    tag: values.tag,
    retry: values.retry,
    hold: values.hold,
    rerun: values.rerun,
    released,
  });
  const summary = renderPlanSummary({
    product: values.product,
    retry: values.retry,
    hold: values.hold,
    rerun: values.rerun,
    ...plan,
  });
  process.stderr.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  // One pipeline per draft, oldest first: a build and a waiting draft differ only in which jobs
  // of the pipeline have work left, which its own first job decides from the draft.
  const work = [...plan.builds, ...plan.awaiting].sort(oldestFirst);
  const outputs = [
    `matrix=${JSON.stringify({ include: work.map(({ tag, sha }) => ({ tag, sha })) })}`,
    `any=${work.length > 0}`,
  ].join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${outputs}\n`);
  else process.stdout.write(`${outputs}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
