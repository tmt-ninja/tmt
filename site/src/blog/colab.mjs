import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";
import {
  articleFromSource,
  artifactHash,
  attr,
  extractArticle,
  metadata,
  rasterExtension,
  sha256,
  stableJson,
  uuid,
  validateApproval,
  walk,
} from "./content.mjs";
import { escapeHtml, readPosts } from "./site.mjs";
import { languageInfo, postDirectory } from "./languages.mjs";

const execute = promisify(execFile);
export async function tmt(...args) {
  const executable = process.env.TMT_EXECUTABLE || "tmt";
  try {
    const { stdout } = await execute(executable, ["colab", ...args, "--json"], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    let detail = error.stderr || error.message;
    try {
      detail = JSON.parse(error.stdout).error?.message ?? detail;
    } catch {}
    throw new Error(
      `Colab command failed (${executable}): ${detail}. Verify the native CLI with tmt colab --help, or set TMT_EXECUTABLE to its absolute path. Do not fall back to the retired runtime.`,
      { cause: error },
    );
  }
}

export async function draft({ root, sourcePath, meta, call = tmt }) {
  metadata(meta);
  const article = articleFromSource(await readFile(sourcePath, "utf8"));
  const css = await readFile(join(root, "src/blog/blog.css"), "utf8");
  const e = escapeHtml;
  const source = `<!doctype html><html lang="${languageInfo(meta.language).tag}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(meta.title)}</title><style>${css}</style></head><body><main class="post-shell"><header class="post-heading"><p class="eyebrow">ARTICLE DRAFT / ${meta.date}</p><h1>${e(meta.title)}</h1><p class="post-summary">${e(meta.summary)}</p></header>${article}</main></body></html>`;
  const directory = join(root, ".private/drafts");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, randomUUID() + ".html");
  await writeFile(path, source, { mode: 0o600, flag: "wx" });
  const created = await call(
    "page",
    "create",
    "--title",
    meta.title,
    "--layout",
    "column",
    "--file",
    path,
    "--no-open",
    "--strict",
  );
  if (!uuid.test(created.pageId))
    throw new Error("Uncertain Colab creation; inspect page list before retrying");
  await call("project", "add", created.pageId, "blog");
  return created;
}

export async function capture(pageId, call = tmt) {
  const snapshot = await call("page", "read", pageId);
  if (
    snapshot.pageId !== pageId ||
    typeof snapshot.revision !== "string" ||
    typeof snapshot.source !== "string" ||
    typeof snapshot.epoch !== "string"
  )
    throw new Error("Invalid Colab source response");
  const raw = articleFromSource(snapshot.source);
  const references = new Set();
  walk(parse(raw), (node) => {
    if (node.tagName === "img") references.add(attr(node, "src"));
  });
  if (references.size > 16) throw new Error("An article may reference at most 16 images");
  const images = new Map();
  const temporary = await mkdtemp(join(tmpdir(), "tmt-blog-attachments-"));
  let totalBytes = 0;
  try {
    for (const reference of references) {
      const attachmentId = reference?.replace(/^colab-attachment:/, "");
      if (!reference?.startsWith("colab-attachment:") || !uuid.test(attachmentId))
        throw new Error("Use full verified Colab attachment IDs for images");
      const image = await call("attachment", "read", pageId, attachmentId, "--output", temporary);
      if (
        typeof image.path !== "string" ||
        !resolve(image.path).startsWith(temporary + "/") ||
        !(await stat(image.path)).isFile()
      )
        throw new Error("Invalid attachment path");
      const bytes = await readFile(image.path);
      totalBytes += bytes.length;
      if (
        bytes.length > 16 * 1024 * 1024 ||
        totalBytes > 64 * 1024 * 1024 ||
        sha256(bytes) !== image.sha256
      )
        throw new Error("Attachment integrity/size mismatch");
      images.set(reference, { bytes, extension: rasterExtension(bytes) });
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return { snapshot, ...extractArticle(raw, images) };
}

// Record the owner's explicit authorization and bind the captured revision and artifact.
export async function importAuthorized({
  root,
  pageId,
  meta,
  approvedBy,
  instruction,
  call = tmt,
}) {
  if (!uuid.test(pageId)) throw new Error("Use a full page UUID");
  metadata(meta);
  const captured = await capture(pageId, call);
  const approval = {
    decision: "approved",
    method: "owner-instruction",
    approvedBy,
    instruction,
    pageId,
    pageRevision: captured.snapshot.revision,
    sourceSha256: sha256(captured.snapshot.source),
    approvedAt: new Date().toISOString(),
    artifactSha256: artifactHash(meta, captured.html, captured.assets),
  };
  return writePost({ root, meta, captured, approval });
}

async function writePost({ root, meta, captured, approval }) {
  await mkdir(join(root, ".private"), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(root, ".private/post-"));
  let committed = false;
  try {
    const files = {
      "meta.json": stableJson(meta),
      "article.html": captured.html,
      "approval.json": stableJson(approval),
      ...captured.assets,
    };
    for (const [path, bytes] of Object.entries(files)) {
      await mkdir(dirname(join(staging, path)), { recursive: true });
      await writeFile(join(staging, path), bytes);
    }
    metadata(meta);
    validateApproval(approval, meta, captured.html, captured.assets);
    if (meta.language !== "en") {
      const posts = await readPosts(join(root, "src/posts"));
      if (!posts.some((post) => post.meta.slug === meta.slug && post.meta.language === "en"))
        throw new Error("Publish the approved English post before its translations");
    }
    const destination = join(root, "src/posts", postDirectory(meta));
    // Refuse replacement so an existing published post is never silently lost.
    // Revisions are prepared as a reviewed Git change using the documented flow.
    try {
      await stat(destination);
      throw new Error("Post already exists; use the documented revision workflow");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await mkdir(dirname(destination), { recursive: true });
    await rename(staging, destination);
    committed = true;
    return {
      slug: meta.slug,
      language: meta.language,
      path: destination,
      artifactSha256: approval.artifactSha256,
    };
  } finally {
    if (!committed) await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, first, second] = process.argv.slice(2);
  let result;
  if (command === "draft" && first && second)
    result = await draft({
      root: resolve("."),
      sourcePath: first,
      meta: JSON.parse(await readFile(second, "utf8")),
    });
  else if (command === "import" && first && second && process.argv[5] && process.argv[6])
    result = await importAuthorized({
      root: resolve("."),
      pageId: first,
      meta: JSON.parse(await readFile(second, "utf8")),
      approvedBy: process.argv[5],
      instruction: process.argv[6],
    });
  else
    throw new Error(
      "Usage: pnpm blog:colab draft source.html metadata.json | pnpm blog:colab import PAGE_UUID metadata.json APPROVED_BY INSTRUCTION",
    );
  console.log(stableJson(result));
}
