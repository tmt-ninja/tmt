import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  activeIntervals,
  assertNoRegression,
  countLines,
  sessionFiles,
  sessionIntervals,
  snapshot,
  subscriptionsPaid,
  unionSeconds,
} from "../src/blog/stats-update.mjs";

const at = (time) => `{"timestamp":"2026-10-01T${time}.000Z","type":"x"}`;

async function world(run) {
  const root = await mkdtemp(join(tmpdir(), "tmt-blog-stats-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("idle gaps split intervals and the loop counts overlapping agents once", () => {
  const seconds = [0, 100, 400, 1000, 1200];
  assert.deepEqual(activeIntervals(seconds, 300), [
    [0, 400],
    [1000, 1200],
  ]);
  assert.equal(
    unionSeconds([
      [0, 400],
      [200, 600],
      [1000, 1200],
    ]),
    800,
  );
});

test("only repository sessions count, and unchanged logs are not rescanned", async () =>
  world(async (root) => {
    const codexRoot = join(root, "codex");
    const claudeRoot = join(root, "claude");
    await mkdir(join(codexRoot, "2026/10/01"), { recursive: true });
    await mkdir(join(claudeRoot, "-Users-me-dev-tmux-team"), { recursive: true });
    await mkdir(join(claudeRoot, "-Users-me-dev-other"), { recursive: true });
    const ours = join(codexRoot, "2026/10/01/a.jsonl");
    await writeFile(
      ours,
      [`{"cwd":"/Users/me/dev/wt/x"}`, at("10:00:00"), at("10:04:00")].join("\n"),
    );
    await writeFile(
      join(codexRoot, "2026/10/01/b.jsonl"),
      [`{"cwd":"/Users/me/elsewhere"}`, at("10:00:00"), at("11:00:00")].join("\n"),
    );
    await writeFile(
      join(claudeRoot, "-Users-me-dev-tmux-team/c.jsonl"),
      [at("10:02:00"), at("10:06:00"), `{"timestamp":"2026-09-01T00:00:00Z"}`].join("\n"),
    );
    await writeFile(join(claudeRoot, "-Users-me-dev-other/d.jsonl"), at("12:00:00"));

    const files = await sessionFiles({ codexRoot, claudeRoot });
    assert.equal(files.length, 3);
    const first = await sessionIntervals(files, null);
    assert.equal(first.scanned, 3);
    assert.equal(first.agentSeconds, 480);
    assert.equal(first.loopSeconds, 360);

    const second = await sessionIntervals(files, first.cache);
    assert.equal(second.scanned, 0);
    assert.equal(second.loopSeconds, 360);

    await writeFile(
      ours,
      [
        `{"cwd":"/Users/me/dev/wt/x"}`,
        at("10:00:00"),
        at("10:04:00"),
        at("10:08:00"),
        at("10:10:00"),
      ].join("\n"),
    );
    await utimes(ours, new Date(), new Date(Date.now() + 5000));
    const third = await sessionIntervals(files, first.cache);
    assert.equal(third.scanned, 1);
    assert.equal(third.loopSeconds, 600);
  }));

test("line counts skip lockfiles, generated files, fixtures, docs and binaries", () => {
  const numstat = [
    "10\t2\tsrc/main.rs",
    "500\t0\tpnpm-lock.yaml",
    "40\t1\ttests/fixtures/frame.json",
    "7\t0\tdocs/guide.md",
    "-\t-\tsite/src/blog/og.png",
    "3\t3\tsrc/generated/types.ts",
    "",
    "5\t1\ttypescript/src/cli.ts",
  ].join("\n");
  assert.deepEqual(countLines(numstat), { added: 15, deleted: 3 });
});

test("subscriptions add one month on each billing day", () => {
  assert.equal(subscriptionsPaid("2026-09-26"), 0);
  assert.equal(subscriptionsPaid("2026-09-27"), 400);
  assert.equal(subscriptionsPaid("2026-11-01"), 800);
  assert.equal(subscriptionsPaid("2026-11-27"), 1200);
  assert.equal(subscriptionsPaid("2027-01-30"), 2000);
});

test("the snapshot is formatted for the home page and never goes backwards", () => {
  const input = {
    asOf: "2026-11-02",
    paidUsd: 800,
    loopSeconds: 686.4 * 3600,
    agentSeconds: 4749 * 3600,
    mergedPrs: 2711,
    linesAdded: 1_596_000,
  };
  const next = snapshot(input);
  assert.deepEqual(
    next.metrics.map(({ value }) => value),
    ["$800", "686 h", "4,700", "2,711", "1.60M"],
  );
  assert.match(next.note, /^27 September to 2 November 2026, /);
  assertNoRegression(snapshot({ ...input, asOf: "2026-11-01", mergedPrs: 2700 }), next);
  assert.throws(
    () => assertNoRegression(next, snapshot({ ...input, mergedPrs: 2600 })),
    /prs went down: 2,711 -> 2,600/,
  );
  assert.throws(
    () => assertNoRegression(next, snapshot({ ...input, asOf: "2026-11-01" })),
    /before/,
  );
});
