import test from "node:test";
import assert from "node:assert/strict";
import { symlink, cp, mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { sha256, artifactHash } from "../src/blog/content.mjs";
import { draft, capture, importAuthorized } from "../src/blog/colab.mjs";
import { readPosts } from "../src/blog/site.mjs";

const pageId = "10000000-0000-4000-8000-000000000001";
const authorization = { approvedBy: "Owner", instruction: "Publish this post." };
const meta = {
  slug: "approved-post",
  title: "Approved title",
  summary: "Summary",
  date: "2026-10-16",
  language: "en",
};

function fakeColab() {
  const state = {
    source:
      '<article id="blog-article"><p>Public body</p><script type="module">document.body.dataset.example = "yes";</script></article><aside>Private note</aside>',
    revision: "before",
    calls: [],
  };
  const call = async (...args) => {
    state.calls.push(args);
    if (args[0] === "page" && args[1] === "read")
      return { pageId, epoch: "1", revision: state.revision, source: state.source };
    throw new Error("Unexpected native call: " + args.join(" "));
  };
  return { state, call };
}

async function world(run) {
  const root = await mkdtemp(join(tmpdir(), "tmt-blog-test-"));
  await mkdir(join(root, "src/posts"), { recursive: true });
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function draftInput(root) {
  await mkdir(join(root, "src/blog"), { recursive: true });
  await writeFile(join(root, "src/blog/blog.css"), ".post-shell { color: black; }");
  const sourcePath = join(root, "draft.html");
  await writeFile(
    sourcePath,
    '<article id="blog-article"><p>Public body</p></article><aside>Private note</aside>',
  );
  return sourcePath;
}

test("draft creates a strict column page without opening a browser", async () =>
  world(async (root) => {
    const sourcePath = await draftInput(root);
    const created = { pageId, path: "/p/10000000" };
    let pageCreated = false;
    const call = async (...args) => {
      if (args[0] !== "page") return { ok: true };
      assert.equal(args[1], "create");
      assert.equal(args[args.indexOf("--layout") + 1], "column");
      assert.ok(args.includes("--strict"));
      assert.ok(args.includes("--no-open"));
      const source = await readFile(args[args.indexOf("--file") + 1], "utf8");
      assert.match(source, /<article id="blog-article"><p>Public body<\/p><\/article>/);
      assert.match(source, /\.post-shell \{ color: black; \}/);
      assert.match(source, /data-theme="dark"/);
      assert.match(source, /<div class="tmt-ui-prose"><article/);
      assert.doesNotMatch(source, /Private note/);
      pageCreated = true;
      return created;
    };
    assert.deepEqual(await draft({ root, sourcePath, meta, call }), created);
    assert.equal(pageCreated, true);
  }));

test("draft embeds the published design-system CSS without external imports", async () =>
  world(async (root) => {
    const sourcePath = await draftInput(root);
    await symlink(new URL("../node_modules", import.meta.url), join(root, "node_modules"), "dir");
    await cp(new URL("../src/blog/blog.css", import.meta.url), join(root, "src/blog/blog.css"));
    let checked = false;
    await draft({
      root,
      sourcePath,
      meta,
      call: async (...args) => {
        if (args[0] === "page" && args[1] === "create") {
          const source = await readFile(args[args.indexOf("--file") + 1], "utf8");
          assert.doesNotMatch(source, /@import/);
          assert.match(source, /--tmt-ui-surface-paper:/);
          assert.match(source, /:where\(\.tmt-ui-prose\)/);
          assert.match(source, /\.tmt-ui-tag/);
          assert.match(source, /data-theme="dark"/);
          checked = true;
          return { pageId };
        }
        return { ok: true };
      },
    });
    assert.equal(checked, true);
  }));

test("draft adds the newly created page to the blog project using the current CLI", async () =>
  world(async (root) => {
    const sourcePath = await draftInput(root);
    const calls = [];
    const created = { pageId, path: "/p/10000000" };
    const call = async (...args) => {
      calls.push(args);
      if (args[0] === "page" && args[1] === "create") return created;
      assert.deepEqual(args, ["project", "add", pageId, "blog"]);
      return { changed: true };
    };
    assert.deepEqual(await draft({ root, sourcePath, meta, call }), created);
    assert.equal(calls.length, 2);
  }));

test("owner-authorized import works without a prior draft and binds only public output", async () =>
  world(async (root) => {
    const fake = fakeColab();
    const started = Date.now();
    const imported = await importAuthorized({
      root,
      pageId,
      meta,
      ...authorization,
      call: fake.call,
    });
    const posts = await readPosts(join(root, "src/posts"));
    assert.equal(posts.length, 1);
    assert.doesNotMatch(posts[0].html, /Private note|tmt-proposal/);
    const scripts = Object.keys(posts[0].assets);
    assert.equal(scripts.length, 1);
    assert.match(scripts[0], /^scripts\/[a-f0-9]{64}\.mjs$/);
    assert.equal(posts[0].assets[scripts[0]].toString(), 'document.body.dataset.example = "yes";');
    const approval = JSON.parse(await readFile(join(imported.path, "approval.json"), "utf8"));
    assert.deepEqual(approval, {
      decision: "approved",
      method: "owner-instruction",
      ...authorization,
      pageId,
      pageRevision: fake.state.revision,
      sourceSha256: sha256(fake.state.source),
      approvedAt: approval.approvedAt,
      artifactSha256: artifactHash(meta, posts[0].html, posts[0].assets),
    });
    assert.ok(
      Date.parse(approval.approvedAt) >= started && Date.parse(approval.approvedAt) <= Date.now(),
    );
    assert.equal(imported.artifactSha256, approval.artifactSha256);
    assert.deepEqual(fake.state.calls, [["page", "read", pageId]]);
    assert.deepEqual(await readdir(join(root, ".private")), []);
  }));

test("missing owner attribution or instruction refuses import and cleans staging", async () => {
  for (const invalid of [{ approvedBy: "" }, { instruction: "" }, { instruction: undefined }])
    await world(async (root) => {
      const fake = fakeColab();
      await assert.rejects(
        importAuthorized({ root, pageId, meta, ...authorization, ...invalid, call: fake.call }),
        /invalid owner authorization/,
      );
      assert.deepEqual(await readdir(join(root, "src/posts")), []);
      assert.deepEqual(await readdir(join(root, ".private")), []);
    });
});

test("capture rejects remote images before any attachment call", async () => {
  const fake = fakeColab();
  fake.state.source =
    '<article id="blog-article"><img src="https://example.com/x.png" alt="x"></article>';
  await assert.rejects(capture(pageId, fake.call), /full verified Colab attachment IDs/);
  assert.deepEqual(fake.state.calls, [["page", "read", pageId]]);
});

test("repeated import preserves the existing post and cleans staging", async () =>
  world(async (root) => {
    const fake = fakeColab();
    const options = { root, pageId, meta, ...authorization, call: fake.call };
    const imported = await importAuthorized(options);
    const originalApproval = await readFile(join(imported.path, "approval.json"), "utf8");
    const originalPosts = await readPosts(join(root, "src/posts"));
    fake.state.source = fake.state.source.replace("Public body", "Replacement body");
    await assert.rejects(importAuthorized(options), /already exists/);
    assert.deepEqual(await readPosts(join(root, "src/posts")), originalPosts);
    assert.equal(await readFile(join(imported.path, "approval.json"), "utf8"), originalApproval);
    assert.deepEqual(await readdir(join(root, ".private")), []);
  }));

test("each language needs owner authorization and imports beside English without overwriting it", async () =>
  world(async (root) => {
    const english = fakeColab();
    await importAuthorized({ root, pageId, meta, ...authorization, call: english.call });
    const original = await readFile(join(root, "src/posts", meta.slug, "approval.json"), "utf8");
    for (const language of ["ja", "zh-hant", "zh-hans"]) {
      const fake = fakeColab();
      const options = {
        root,
        pageId,
        meta: { ...meta, language },
        ...authorization,
        call: fake.call,
      };
      await assert.rejects(
        importAuthorized({ ...options, instruction: "" }),
        /invalid owner authorization/,
      );
      const imported = await importAuthorized(options);
      assert.equal(imported.path, join(root, "src/posts", meta.slug, language));
      assert.equal(imported.language, language);
      const record = JSON.parse(await readFile(join(imported.path, "meta.json"), "utf8"));
      assert.equal(record.language, language);
      await assert.rejects(importAuthorized(options), /already exists/);
    }
    assert.equal(
      await readFile(join(root, "src/posts", meta.slug, "approval.json"), "utf8"),
      original,
    );
    assert.equal((await readPosts(join(root, "src/posts"))).length, 4);
    assert.deepEqual(await readdir(join(root, ".private")), []);
  }));

test("a translation cannot import before English and leaves no staged post", async () =>
  world(async (root) => {
    const fake = fakeColab();
    await assert.rejects(
      importAuthorized({
        root,
        pageId,
        meta: { ...meta, language: "ja" },
        ...authorization,
        call: fake.call,
      }),
      /English post before/,
    );
    assert.deepEqual(await readdir(join(root, "src/posts")), []);
    assert.deepEqual(await readdir(join(root, ".private")), []);
  }));

test("imported metadata binds tags and key numbers in the stored authorization", async () =>
  world(async (root) => {
    const fake = fakeColab();
    const keyed = {
      ...meta,
      tags: ["design", "colab"],
      keyNumber: { value: "2.9×", label: "tokens per line" },
    };
    const imported = await importAuthorized({
      root,
      pageId,
      meta: keyed,
      ...authorization,
      call: fake.call,
    });
    const path = join(imported.path, "meta.json");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), keyed);
    for (const changed of [
      { ...keyed, tags: ["workflow"] },
      { ...keyed, keyNumber: { ...keyed.keyNumber, value: "3×" } },
    ]) {
      await writeFile(path, JSON.stringify(changed));
      await assert.rejects(readPosts(join(root, "src/posts")), /hash mismatch/);
    }
    await writeFile(path, JSON.stringify(keyed));
    assert.deepEqual((await readPosts(join(root, "src/posts")))[0].meta, keyed);
  }));

test("retired prepare and publish commands fail with current usage before contacting Colab", async () =>
  world(async (root) => {
    const execute = promisify(execFile);
    const entry = fileURLToPath(new URL("../src/blog/colab.mjs", import.meta.url));
    for (const args of [
      ["prepare", pageId, "missing-meta.json"],
      ["publish", pageId],
    ])
      await assert.rejects(
        execute(process.execPath, [entry, ...args], {
          cwd: root,
          env: { TMT_EXECUTABLE: join(root, "missing-tmt"), TMT_AGENT: "1", BROWSER: "true" },
        }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, /Usage: pnpm blog:colab draft .*pnpm blog:colab import/);
          assert.doesNotMatch(
            error.stderr,
            /blog:colab prepare|blog:colab publish|ENOENT|Colab command failed/,
          );
          return true;
        },
      );
    assert.deepEqual(await readdir(root), ["src"]);
  }));
