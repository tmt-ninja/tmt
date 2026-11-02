import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../src/blog/build.mjs";
import {
  filesBelow,
  indexBody,
  layout,
  localOrigin,
  locationConfig,
  repositoryUrl,
} from "../src/blog/site.mjs";

const meta = {
  slug: "agent-conversations",
  title: "Title & <markup>",
  summary: "Summary",
  date: "2026-10-16",
  language: "en",
};
const site = {
  title: "TMT Journal",
  description: "Notes",
  published: { product: false, journal: true, colab: false, github: true },
};
const origin = "https://example.com";
test("blog URLs derive from the site base and escape metadata", () => {
  for (const base of ["/", "/tmt/", "/custom/path/"]) {
    const location = locationConfig({ base, origin, repository: "renamed-owner/renamed-repo" });
    assert.equal(location.base, base + "blog/");
    const body = indexBody([{ meta }], site, location);
    assert.ok(body.includes(`href="${base}blog/posts/agent-conversations/"`));
    assert.match(body, /Title &amp; &lt;markup&gt;/);
    const html = layout({ site, location, title: "Blog", description: "Notes", body });
    assert.equal(
      (html.match(/href="https:\/\/github.com\/renamed-owner\/renamed-repo"/g) ?? []).length,
      2,
    );
    assert.ok(!html.includes(`href="${base}"`));
    assert.ok(html.includes(`href="${origin}${base}blog/"`));
  }
  for (const base of ["../", "//host/", "/a/../", "/missing-slash"])
    assert.throws(() => locationConfig({ base }));
});

test("the origin is the caller's; a local run without one gets a neutral default, never an org", () => {
  assert.equal(locationConfig({ base: "/" }).origin, localOrigin);
  assert.doesNotMatch(localOrigin, /github\.io|tmt/);
  assert.equal(locationConfig({ base: "/", origin }).url, `${origin}/blog/`);
  for (const bad of [
    "http://example.com",
    "https://example.com/",
    "https://example.com/x",
    "example.com",
    "",
  ])
    assert.throws(
      () => locationConfig({ base: "/", origin: bad }),
      /SITE_ORIGIN must be an HTTPS origin/,
    );
});

test("generation renders articles; production removes demo inputs without touching approved sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmt-blog-build-"));
  try {
    for (const path of ["src/blog", "src/shared", "src/posts", "scripts/fixtures/blog"])
      await cp(path, join(root, path), { recursive: true });
    const demo = await generate({ root, demo: true, base: "/nested/" });
    const html = await readFile(
      join(demo.output, "posts/interactive-article-example/index.html"),
      "utf8",
    );
    assert.match(html, /How many connections/);
    assert.match(html, /noindex,nofollow/);
    assert.doesNotMatch(demo.publicFiles["feed.xml"], /<item>/);
    // Without an origin the pages carry the neutral local one (a build refuses that: blog-build).
    await generate({ root, base: "/nested/" });
    assert.match(
      (await readFile(join(root, "blog/index.html"), "utf8")).toString(),
      new RegExp(`<link rel="canonical" href="${localOrigin}/nested/blog/">`),
    );
    const production = await generate({ root, base: "/nested/", origin });
    const first = await filesBelow(join(root, "blog"));
    assert.equal(
      Object.keys(first).some((path) => path.includes("interactive-article-example")),
      false,
    );
    assert.doesNotMatch(first["index.html"].toString(), /Template preview/);
    // Canonical links, RSS and sitemap carry the given origin and no other.
    const given = `${origin}/nested/blog/`;
    assert.ok(first["index.html"].toString().includes(`<link rel="canonical" href="${given}">`));
    for (const feed of ["feed.xml", "sitemap.xml"]) {
      const urls = [
        ...production.publicFiles[feed].matchAll(/<(?:link|guid|loc)[^>]*>([^<]+)</g),
      ].map((match) => match[1]);
      assert.ok(urls.length > 0 && urls.every((url) => url.startsWith(given)), `${feed}: ${urls}`);
    }
    await generate({ root, base: "/nested/", origin });
    assert.deepEqual(await filesBelow(join(root, "blog")), first);
    assert.equal((await filesBelow(join(root, "src/posts")))[".gitkeep"].length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository configuration accepts a build-owned repository and rejects URLs or unsafe paths", () => {
  assert.equal(repositoryUrl("new-owner/project"), "https://github.com/new-owner/project");
  for (const value of [
    "",
    "owner",
    "https://github.com/owner/repo",
    "../repo",
    "owner/..",
    "owner/repo/path",
    "owner/repo?x",
  ])
    assert.throws(() => repositoryUrl(value), /must name owner\/repository/);
});

test("index snapshot and optional key number render escaped; tag pages retain their intro", () => {
  const location = locationConfig({ base: "/tmt/" });
  const post = { meta: { ...meta, keyNumber: { value: "2.9× <x>", label: "tokens & lines" } } };
  const html = indexBody([post], site, location);
  assert.match(html, /We run a team of agents\.<br>These are the numbers\./);
  assert.match(html, /never reads the code/);
  assert.match(html, /2\.9× &lt;x&gt;/);
  assert.match(html, /tokens &amp; lines/);
  assert.doesNotMatch(html, /article-number|article-arrow|Field notes/);
  assert.match(indexBody([{ meta }], site, location), /class="article-key-number"><\/div>/);
  const topic = indexBody([post], site, location, "en", false, { tag: "engineering" });
  assert.match(topic, /Articles tagged #engineering/);
  assert.doesNotMatch(topic, /index-stats|index-contact/);
});

test("generation validates the actual root's committed stats before writing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmt-blog-stats-"));
  try {
    for (const path of ["src/blog", "src/shared", "src/posts"])
      await cp(path, join(root, path), { recursive: true });
    const path = join(root, "src/blog/stats.json");
    const snapshot = JSON.parse(await readFile(path, "utf8"));
    snapshot.metrics[0].value = "$123";
    await writeFile(path, JSON.stringify(snapshot));
    await generate({ root, base: "/" });
    assert.match(await readFile(join(root, "blog/index.html"), "utf8"), /\$123/);
    snapshot.asOf = "2026-02-30";
    await writeFile(path, JSON.stringify(snapshot));
    await assert.rejects(generate({ root, base: "/" }), /Invalid blog stats/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("blog chrome requires explicit publication decisions from build configuration", () => {
  const location = locationConfig({ base: "/" });
  for (const published of [undefined, {}, { ...site.published, colab: "false" }])
    assert.throws(
      () =>
        layout({
          site: { ...site, published },
          location,
          title: "Journal",
          description: "Notes",
          body: "",
        }),
      /explicit published/,
    );
});
