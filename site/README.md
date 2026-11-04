## Colab landing

The English `/colab/` route is a landing design exploration within the site,
separate from Home and the retained handbook chapters. Four large feature
close-ups show annotation, agent conversation, live documents and work
organization, followed by a short installation guide. The UI close-ups are
illustrations. The route reuses the site theme and logo; the development embed
below annotates it directly.

## Local Colab embed preview

The opt-in development overlay annotates the live handbook DOM without copying it
into a Colab HTML page. Start from an isolated checkout:

```sh
VITE_COLAB_EMBED=1 TMT_EMBED_IDENTITY=<your-identity-uuid> pnpm dev --port 5185 --strictPort
```

Use the pointer icon or C to toggle Colab mode without opening a menu. The
shortcut is inactive while editing text, composing with an IME, or holding any
modifier key. The separate details icon opens Connection & threads, even when
Colab mode is off. Hover outlines a component; click it or select
text to open an anchored discussion. Clicking outside collapses it, and reopening
restores its draft. The composer stays at the bottom while messages scroll; new
turns and agent replies scroll the message area to the latest entry. Enter sends to the selected agent; Shift+Enter adds a line.
Comment stores a local-only turn. Resolve closes the bubble and hides its marker;
the discussion remains in the list for reopening. Comments and drafts stay in this browser's local storage
across reload/HMR. They are local review data, not encrypted/shared Colab records.
Missing anchors remain in the annotation list. Open one and use Reattach this
discussion, then click a component or select text to move its anchor without
changing its turns or draft. The Connection view lists local agents and opens
the existing Remote entry for user-controlled device pairing.

Repeated activation and HTTP retries share one bounded server-session send
operation, retained before dispatch across browser reload/HMR. A definite
pre-dispatch error releases the hold. An uncertain failure never redispatches
that operation within the same server session: the composer shows the frozen
message and an explicit clear action. Check TMT before clearing the hold or
restarting the preview, because the request may have reached the agent. Editing
an unacknowledged send cannot allocate a replacement operation until it is
cleared. A temporary reply lookup failure remains visible and does not stop
subsequent automatic checks.

Explicit Ask actions use the configured sender and installed TMT CLI through a
loopback-only, same-origin Vite middleware. Open discussions automatically check
for replies every three seconds. Reply lookup uses the retained TMT exchange
owned by the configured sender, so old threads can read replies after a preview
restart while TMT retains that exchange. No pairing or grants are performed by
the overlay. The development middleware and FAB are excluded from production
builds, even when the embed flag is set.

## Blog

The blog is built as complete HTML under `${SITE_BASE}blog/`. The full Vite build
remains in `site/dist`; `node src/blog/pages.mjs` creates the blog-only
`site/dist-pages` directory for GitHub Pages. It retains `blog/**` and only the
shared assets those pages reference. Home, locale Homes, handbook redirects and
Colab remain in source and the full build, but are not published. The Pages root
redirects to the blog with a meta refresh and visible link; `404.html` links to
the blog and repository. Home, Colab and blog header/footer navigation share the framework-free
[chrome renderer](src/shared/site-chrome.mjs) and `src/shared/site-chrome.css`.
The React adapter preserves the existing language/theme controls in a dedicated slot;
Home maps the paper/text/rule roles to its own theme. The adapter measures the
wrapped header and feeds one root `html` scroll-padding rule, so in-page anchors
on Home and Colab stay below it without per-anchor margins. Static Journal pages
use the shared 128px fallback and load no additional observer script. Phone navigation wraps so all
published destinations stay reachable. Callers provide the section path, mark URL,
brand link, RSS URL, optional X handle, and navigation items (`label`, `url`, `published`,
optional `external`). External items carry the arrow and appear in the footer; labels
have no behavioral meaning. Unsafe URLs and missing publication flags fail validation,
including on hidden items. The landing pages reuse the marketing-owned mark and X
handle without changing their copy.

Blog `site.json` supplies `published.product`, `journal`, `colab` and `github` booleans.
Today Journal and GitHub are visible in the blog; Product and Colab remain hidden
because the Pages artifact does not publish them. The full local Home/Colab build
links to all three site sections. These local links do not change the Pages artifact.
Set a blog destination's flag only when it is published. An optional bare `xHandle`
(1–15 letters, digits or underscores) enables Follow on X in both header and footer.
The working title is
TMT Journal. Its shared layout uses a black-only ninja palette in both color
preferences, rice-paper text, a red accent and a file-backed owner-supplied team mark.
The sticky header and footer are shared by index, topic and post pages. The selected
ninja SVG is the header mark; a matching PNG is the favicon and touch icon.
Every page carries Open Graph and X card metadata with absolute `SITE_ORIGIN`
URLs: the canonical URL, the article title and summary, and a 1200×630 card:
`src/blog/share/<slug>.png` when an article has one, else `src/blog/og.png`.
Provenance is recorded in [the blog style source note](src/blog/PROVENANCE.md).

Marketing owns and reviews the blog end to end: code in `src/blog/` and approved
articles in `src/posts/<slug>/`. English (`en`) stays at the slug root. Each
translation has its own `ja/`, `zh-hant/` or `zh-hans/` subdirectory with the same
`article.html`, `meta.json`, `approval.json`, `scripts/` and raster `images/` files
as needed. Metadata `slug` identifies the English post and `language` identifies
the variant. English must exist before importing translations; each language
requires its own explicit owner authorization of its exact content and metadata.

English URLs remain `${SITE_BASE}blog/` and `blog/posts/<slug>/`. Other languages
use `blog/<language>/` and `blog/<language>/posts/<slug>/`. The link switcher keeps
the article slug and selects an index language; it needs no client script. Shell
labels remain English and declare `lang="en"`; article HTML uses `en`, `ja`,
`zh-Hant` or `zh-Hans` as appropriate. Indexes show the approved translation or
label an English fallback. A missing article translation renders English with a
visible notice, English canonical URL and `noindex,follow`; it is excluded from
article alternates, feeds and the sitemap. A language index with zero approved
translations also falls back to English: `lang="en"`, English canonical, visible
notice and `noindex,follow`; it is excluded from index alternates and the sitemap.
Each language has its own `feed.xml` with its RSS language tag and only approved
variants; an empty feed links to the English index. The sitemap lists available
language indexes and actual approved article URLs, never fallback URLs.

Before committing a translation, add its exact directory (for example
`site/src/posts/example-post/ja`: `ja`) to the repository `languageExceptions` map
in the same PR, with Core review. Only article prose and metadata title/summary
may use that language; keys, code and comments remain English. The layout guard
requires the complete article/metadata/approval bundle; wildcard and empty
allowances are rejected. Each translation is delivered as a separate approved post PR.

Run from `site/`:

```sh
pnpm install --frozen-lockfile
pnpm check
export SITE_ORIGIN=https://example.com
export SITE_REPOSITORY=owner/repository
pnpm build                          # full production build; no illustrative fixtures
node src/blog/pages.mjs              # create and list dist-pages
node src/blog/verify-dist.mjs --pages # verify the exact deployment directory
SITE_BASE=/ pnpm build               # root deployment: /blog/
pnpm blog:demo                      # explicit noindex example, empty RSS/sitemap
pnpm exec vp preview --outDir dist-pages --port 4176 --strictPort
```

`SITE_BASE` defaults to `/tmt/`. A production build requires `SITE_ORIGIN`, the
HTTPS origin the site is served from, without a trailing slash or path; it has no
default, because it is the host in the blog's canonical links, link previews, RSS
and sitemap. `.github/workflows/site.yml` sets `https://tmt.ninja` with `SITE_BASE=/`,
matching the custom domain in the repository's Pages settings and the `tmt.ninja`
DNS records; the former `<owner>.github.io/tmt/` URLs redirect there.
`SITE_REPOSITORY` is `owner/repository`; it overrides `GITHUB_REPOSITORY`, which
Actions supplies. Production builds require one of them and derive the GitHub
URL without hard-coding an owner. Local dev/demo runs use a neutral example
repository when neither is set. This pipeline makes no DNS or install-script
serving changes: `install.tmt.ninja` serves the installer from Releases.
`verify-dist` takes the same `SITE_ORIGIN` and fails a production artifact whose
canonical links, RSS or sitemap name another origin. The dev server, `pnpm blog:demo`
and the unit tests need none and use a neutral local origin.
The blog requires an absolute directory base. The handbook-only relative/hash
preview (`SITE_BASE=./ VITE_SITE_HISTORY=hash pnpm exec vp build`) still works,
but excludes the blog. For local article HMR use `TMT_BLOG_DEMO=1 pnpm dev`;
production artifacts always reject the development policy. Generated `blog/`
inputs are ignored and rebuilt; approved sources are never cleared by a build.

### Index statistics and key numbers

The index copy and layout follow the owner-approved home mock. Its five metrics
and source note come from one committed [stats snapshot](src/blog/stats.json):
`asOf` is a real ISO calendar date; `metrics` contains the ordered IDs
`subscriptions`, `loop`, `agents`, `prs`, `code`, each with a display `value`
(up to 64 characters) and `label` (up to 160); `note` is bounded to 2,000
characters. The build validates the exact shape and rejects missing/extra fields,
empty strings and control characters. Builds never read host session logs or
git history; the snapshot changes only through committed data updates.

`node src/blog/stats-update.mjs [--write]`, run from `site/` on the owner's host,
recomputes the snapshot: loop hours and agent-hours from Codex and Claude session
logs of this repository (activity gaps over five minutes end an interval), merged
PRs from one GitHub search, and added lines from `origin/main` numstat minus the
exclusion list in that file. Subscriptions add $400 on each 27th from 27 September
2026. A per-file cache under `$XDG_CACHE_HOME/tmt-blog-stats/` (size and mtime)
rescans only changed logs and keeps the intervals of logs the providers have since deleted. The command refuses to write when any cumulative metric
would go down. A daily tmt-mkt Squad cron commits the result as a data-only PR.

Optional post metadata `keyNumber` is exactly `{ "value": "2.9×", "label": "tokens per line" }`.
Both fields must be nonempty text without control characters; `value` is bounded
to 32 characters and `label` to 100. Index and topic rows escape and render it
in the key-number column; omitted values leave that column empty. Like tags, it is
approval-bound in `meta.json`; an `editorial.json` override can change it after
publication under the editorial policy below.

### Tags

Optional `tags` metadata holds zero to three unique lowercase slugs from the
fixed vocabulary in [tags.mjs](src/blog/tags.mjs): `announcements` (project news),
`colab` (Colab use), `design` (interface design), `engineering` (implementation),
`shugyo` (the weekly Shugyō retro series), `usage` (allowance, cost and model use)
and `workflow` (working with agents). Unknown, duplicate or excessive tags fail
validation; values are never silently normalized. Tags and `keyNumber` in
`meta.json` are part of the approved artifact. To add or change them after
publication, put them in the post's optional `editorial.json` (only `tags` and
`keyNumber`); it overrides those two fields, needs no new approval and is not part
of the approval hash (owner decision, 3 November 2026).

Posts and listing rows show ordinary `#tag` links. The build generates
`${SITE_BASE}blog/tags/<tag>/` for English, or `blog/<language>/tags/<tag>/` for
translations, listing only matching approved variants in that language. Tags on
English fallback articles link to the English topic page. Unused tag/language
combinations have no empty page and no switcher link; tag alternates include only
languages with real matching posts. These pages have their own
canonical URLs and sitemap entries, and each RSS item includes its tags as
`category` elements. There is no client-side search or separate deployment.

### Colab review and import

Use the installed native TMT CLI, optionally with `TMT_EXECUTABLE` set to its
absolute path. Draft source must contain exactly one `article#blog-article`.
Metadata requires `slug`, `title`, `summary`, `date` (YYYY-MM-DD) and
`language` (`en`, `ja`, `zh-hant` or `zh-hans`), with optional `tags` and `keyNumber` as described above. Images use full `colab-attachment:<UUID>` references.
Draft creation uses Colab's `column` layout and adds the new page to the `blog`
project, with strict markup validation and no automatic browser opening.

```sh
pnpm blog:colab draft /private/path/source.html /private/path/meta.json
# Run only after the owner explicitly authorizes this post and its metadata.
pnpm blog:colab import PAGE_UUID /private/path/meta.json APPROVED_BY INSTRUCTION
pnpm check
pnpm build
```

Owner authorization (owner decision, 4 November 2026): the Colab `proposal`
commands are gone from the current CLI. `draft` and `import` are the supported
blog importer commands; `prepare` and `publish` are no longer available.
Agents run `import` only on the owner's explicit instruction for that post,
quoting that instruction in `INSTRUCTION` and naming the owner in `APPROVED_BY`.
Quote shell arguments containing spaces. The CLI records this authorization; it
does not authenticate the person named in those arguments or obtain approval.

Import captures the page and verified attachments through the public CLI and
writes `approval.json` with `method: "owner-instruction"`, who authorized it,
their instruction, the captured page revision, the full-source SHA-256, an import
timestamp and the artifact hash. Validation requires all fields and a matching
hash of the canonical article, scripts, images and metadata. The import timestamp
records capture, not the time the owner gave the instruction. Review those bytes
and the authorization evidence together in the PR; changed content needs renewed
authorization.

Existing Colab approval records remain valid: their page/proposal identifiers,
source hash, prepared revision, trusted-device decision fields and artifact hash
are still checked at build time. Their decision timestamps retain Colab's decimal
millisecond strings or stored ISO timestamps. New imports do not query proposal
state or generate those legacy records.

The importer never reads discussion exports. `.private/drafts` holds local draft
pages and `.private/post-*` holds import staging until the post is moved into
`src/posts`; failed writes remove staging. Temporary attachments are removed
after capture. Do not commit full Colab pages, exports, conversations or pending
drafts. CI checks canonical article/assets and recorded hashes; it cannot
authenticate owner instructions or historical Colab decisions.

Intentional `type=module` snippets become content-addressed source files, then
Vite bundles them into external assets. They must be self-contained: build-time
imports are rejected. The existing blog CSP allows same-origin scripts/styles
and raster/data images, blocks connections, frames and forms, and adds no
external sources. Article code is trusted reviewed code on the same origin as
Home; it can access that origin's DOM/storage. Do not include secrets or assume
an article is sandboxed. Inline event handlers and external resource URLs are
rejected; inline article CSS cannot load resources.

Import refuses to overwrite an existing language variant. For a revision, privately
back up the variant, obtain the owner's authorization for the revision, remove that variant's
tracked directory in the feature branch and import again. For English, back up
the entire slug directory first; after importing the approved English revision,
restore its translation directories unchanged before checking the result.
Review the complete diff and restore the backup if import fails. Changing English
does not approve or rewrite existing translations. Never edit committed
article/assets or approval-bound metadata without renewed owner authorization.
The `editorial.json` policy above applies separately to tags and key numbers.

Only the existing `Build site` job checks/builds, prunes and verifies the blog-only
output before uploading `dist-pages`. `verify-dist --pages` rejects non-blog
HTML, unused shared assets, missing HTML/CSS/module dependencies, invalid root
redirect/404 links and a mismatched repository. Production verification is the default; demo requires `--demo` and
is rejected by the upload gate. Main merges follow the existing Pages workflow;
PRs never deploy. Publication timing remains Ben's decision.
