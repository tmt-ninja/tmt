// Recomputes the blog home snapshot (stats.json) from local agent session logs, origin/main
// history and one GitHub search. Run from site/: node src/blog/stats-update.mjs [--write].
import { spawn, execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { validateStats } from "./stats.mjs";

// The measured period starts with the oldest local session logs; both plans bill on the 27th.
export const since = "2026-09-27";
export const monthlyUsd = 400;
// Two timestamps further apart than this end an active interval.
export const idleGapSeconds = 300;
// Files whose lines are not written by hand: lockfiles, generated output, binary or recorded
// assets, fixtures, test vectors, benchmarks and documentation.
export const excludedPath =
  /(pnpm-lock\.yaml|Cargo\.lock|package-lock\.json|\.snap$|\/snapshots?\/|\.(png|svg|jpg|webp|ico|gif|woff2?|ttf|zst|gz|wasm|cast|ansi)$|oracle\.json$|generated|\.min\.|fixtures?\/|\/vectors?\/|\/bench(mark)?s?\/|\/dist\/|\/assets\/.*\.js$|\.mdx?$)/;
const cacheVersion = 1;

const timestampPattern = /"timestamp":"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)/;
const cwdPattern = /"cwd":"([^"]*)"/;
const startSeconds = Date.parse(since + "T00:00:00Z") / 1000;

export function activeIntervals(seconds, gap = idleGapSeconds) {
  const sorted = [...seconds].sort((a, b) => a - b);
  const intervals = [];
  for (const time of sorted) {
    const last = intervals.at(-1);
    if (last && time - last[1] <= gap) last[1] = time;
    else intervals.push([time, time]);
  }
  return intervals;
}

export function unionSeconds(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current = null;
  for (const [start, end] of sorted) {
    if (current && start <= current[1]) current[1] = Math.max(current[1], end);
    else {
      if (current) total += current[1] - current[0];
      current = [start, end];
    }
  }
  return current ? total + current[1] - current[0] : total;
}

const sumSeconds = (intervals) => intervals.reduce((total, [start, end]) => total + end - start, 0);

// Codex sessions count only when their working directory is this repository or one of its
// worktrees; Claude sessions are already grouped by project directory.
export const repositoryCwd = (cwd) => cwd.includes("tmux-team") || cwd.includes("/dev/wt/");

async function* lines(path) {
  if (path.endsWith(".zst")) {
    const child = spawn("zstd", ["-dcq", path], { stdio: ["ignore", "pipe", "inherit"] });
    yield* createInterface({ input: child.stdout, crlfDelay: Infinity });
    return;
  }
  yield* createInterface({ input: createReadStream(path), crlfDelay: Infinity });
}

export async function scanSession(path, requireCwd) {
  const seconds = [];
  let accepted = !requireCwd;
  for await (const line of lines(path)) {
    if (!accepted) {
      const cwd = cwdPattern.exec(line.slice(0, 4000));
      if (cwd) {
        if (!repositoryCwd(cwd[1])) return [];
        accepted = true;
      }
    }
    const match = timestampPattern.exec(line.slice(0, 300));
    if (!match) continue;
    const time = Date.parse(match[1] + "Z") / 1000;
    if (time >= startSeconds) seconds.push(time);
  }
  return accepted ? activeIntervals(seconds) : [];
}

async function filesBelow(root, keep) {
  const found = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true, recursive: true });
  } catch (error) {
    if (error.code === "ENOENT") return found;
    throw error;
  }
  for (const entry of entries)
    if (entry.isFile() && keep(entry.name)) found.push(join(entry.parentPath, entry.name));
  return found;
}

export async function sessionFiles({ codexRoot, claudeRoot }) {
  const codex = (await filesBelow(codexRoot, (name) => /\.(jsonl|zst)$/.test(name))).map(
    (path) => ({ path, requireCwd: true }),
  );
  const projects = await readdir(claudeRoot).catch(() => []);
  const claude = [];
  for (const project of projects.filter((name) => name.includes("-dev-tmux-team")))
    for (const path of await filesBelow(join(claudeRoot, project), (name) =>
      name.endsWith(".jsonl"),
    ))
      claude.push({ path, requireCwd: false });
  return [...codex, ...claude];
}

// Rescans only files whose size or modification time changed since the cached run.
export async function sessionIntervals(files, cache) {
  const next = { version: cacheVersion, since, files: {} };
  const reuse = cache?.version === cacheVersion && cache.since === since ? cache.files : {};
  let scanned = 0;
  for (const { path, requireCwd } of files) {
    const { size, mtimeMs } = await stat(path);
    const old = reuse[path];
    if (old && old.size === size && old.mtimeMs === mtimeMs) next.files[path] = old;
    else {
      next.files[path] = { size, mtimeMs, intervals: await scanSession(path, requireCwd) };
      scanned++;
    }
  }
  const sessions = Object.values(next.files).filter(({ intervals }) => intervals.length);
  return {
    cache: next,
    scanned,
    loopSeconds: unionSeconds(sessions.flatMap(({ intervals }) => intervals)),
    agentSeconds: sessions.reduce((total, { intervals }) => total + sumSeconds(intervals), 0),
  };
}

// Counts added and deleted lines from `git log --numstat` output, skipping excluded paths and
// binary entries.
export function countLines(numstat) {
  let added = 0;
  let deleted = 0;
  for (const line of numstat.split("\n")) {
    const [add, del, path] = line.split("\t");
    if (path === undefined || add === "-" || excludedPath.test(path)) continue;
    added += Number(add);
    deleted += Number(del);
  }
  return { added, deleted };
}

export function subscriptionsPaid(asOf) {
  const [startYear, startMonth, billingDay] = since.split("-").map(Number);
  const [year, month, day] = asOf.split("-").map(Number);
  const months = (year - startYear) * 12 + month - startMonth + (day >= billingDay ? 1 : 0);
  return Math.max(months, 0) * monthlyUsd;
}

const grouped = (value) => Math.round(value).toLocaleString("en-US");
const longDate = (date) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
const millions = (value) =>
  value >= 1e6 ? (value / 1e6).toFixed(2) + "M" : Math.round(value / 1e3) + "k";

export function snapshot({ asOf, paidUsd, loopSeconds, agentSeconds, mergedPrs, linesAdded }) {
  const year = asOf.slice(0, 4);
  return validateStats({
    asOf,
    metrics: [
      {
        id: "subscriptions",
        value: "$" + grouped(paidUsd),
        label: `subscriptions paid so far · $${monthlyUsd} a month`,
      },
      {
        id: "loop",
        value: grouped(loopSeconds / 3600) + " h",
        label: "autonomous agent loop running",
      },
      // Agent-hours are rounded to the hundred; the logs do not support more precision.
      {
        id: "agents",
        value: grouped(Math.round(agentSeconds / 360000) * 100),
        label: "agent-hours of work",
      },
      { id: "prs", value: grouped(mergedPrs), label: "pull requests merged" },
      { id: "code", value: millions(linesAdded), label: "lines of hand-written code added" },
    ],
    note: `${longDate(since)} to ${longDate(asOf)} ${year}, from our agent session logs and git history. Subscriptions: one Claude and one Codex plan at $${monthlyUsd / 2} a month each, $${grouped(paidUsd)} paid in total. Loop hours count time with at least one agent active; agent-hours add up every agent. Lockfiles, generated files, fixtures and docs are not counted as code.`,
  });
}

const metricNumber = (value) => {
  const number = Number(value.replace(/[$,\sh]/g, "").replace(/[Mk]$/, ""));
  return number * (value.endsWith("M") ? 1e6 : value.endsWith("k") ? 1e3 : 1);
};

// Every metric is cumulative, so a smaller value means missing logs or a broken query.
export function assertNoRegression(previous, next) {
  if (next.asOf < previous.asOf) throw new Error(`asOf ${next.asOf} is before ${previous.asOf}`);
  for (const [index, metric] of next.metrics.entries()) {
    const old = previous.metrics[index];
    if (metricNumber(metric.value) < metricNumber(old.value))
      throw new Error(`${metric.id} went down: ${old.value} -> ${metric.value}`);
  }
}

function repositoryName(cwd) {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
  const match = /github\.com[:/]([^/]+\/[^/.]+?)(\.git)?\s*$/.exec(url);
  if (!match) throw new Error("origin is not a GitHub repository");
  return match[1];
}

async function main(args) {
  const write = args.includes("--write");
  const asOf = new Date().toLocaleDateString("en-CA");
  const site = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const statsPath = join(site, "src/blog/stats.json");
  const cachePath = join(
    process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    "tmt-blog-stats/sessions.json",
  );
  const cache = await readFile(cachePath, "utf8").then(JSON.parse, () => null);
  const sessions = await sessionIntervals(
    await sessionFiles({
      codexRoot: join(homedir(), ".codex/sessions"),
      claudeRoot: join(homedir(), ".claude/projects"),
    }),
    cache,
  );
  const git = (...gitArgs) =>
    execFileSync("git", gitArgs, { cwd: site, encoding: "utf8", maxBuffer: 1 << 30 });
  git("fetch", "-q", "origin", "main");
  const { added } = countLines(
    git("log", "origin/main", `--since=${since}`, "--numstat", "--format="),
  );
  const mergedPrs = Number(
    execFileSync(
      "gh",
      [
        "api",
        "-X",
        "GET",
        "search/issues",
        "-f",
        `q=repo:${repositoryName(site)} is:pr is:merged merged:>=${since}`,
        "--jq",
        ".total_count",
      ],
      { encoding: "utf8" },
    ),
  );
  const next = snapshot({
    asOf,
    paidUsd: subscriptionsPaid(asOf),
    loopSeconds: sessions.loopSeconds,
    agentSeconds: sessions.agentSeconds,
    mergedPrs,
    linesAdded: added,
  });
  const previous = validateStats(JSON.parse(await readFile(statsPath, "utf8")));
  assertNoRegression(previous, next);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(sessions.cache));
  const changed = JSON.stringify(next.metrics) !== JSON.stringify(previous.metrics);
  if (write && changed) await writeFile(statsPath, JSON.stringify(next, null, 2) + "\n");
  console.log(
    JSON.stringify(
      { changed, written: write && changed, rescannedLogs: sessions.scanned, ...next },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
