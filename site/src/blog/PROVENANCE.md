# Visual source

The template adapts the TMT Colab marketing landing's system font stack,
square controls, hairline rules and spacing. Its black-only ninja palette uses
ink (`#0a0a0a`), rice-paper text (`#f2efe9`), muted text (`#8f8b84`) and one
red accent (`#e2452c`) in both color preferences. It does not import the
Colab application or the private browser component package.

Source repository: https://github.com/pj-tmt/tmt

Verified original Colab source commit: `2981a7ba178cc60c35a8c42445f11377e1e4b205`.

- `site/src/colab/colab-landing.css`, last path change
  `031b1569c427515a0e4876930a9fce04f13a2acd`.
  SHA-256: `6e94873a76261684a11a65320213e241781e45f07518a3eb9e766c5ddb845cb0`.
- The original neutral palette was inherited by that landing from `site/src/styles.css`, last
  path change `4f76003de96c1d7b1c536860769f6cdb231509fe`.
  SHA-256 at the verified main commit:
  `78b3fa6af5145b568ef907948d25faea8d617f520f3900ec346d26c74e047619`.
- `site/src/blog/mark.svg` is the owner-reviewed, hand-drawn hooded terminal
  mark based on the TMT GitHub organization avatar. It replaces the blog's former
  aurora mark; Home and Colab keep their own assets. The mark remains an external
  SVG favicon in development and production, never an inline data URL.
- `site/src/blog/favicon.png` is the owner-supplied team icon (hooded ninja with
  a terminal prompt and red mask), padded to square on black and resized to
  192×192. It remains the blog's touch icon.
  SHA-256: `ee71f53e5e4c98fd4307a4224aaccdedeafc82bca83259799f78b3004ed5914c`.
- `site/src/blog/og.png` is the 1200×630 link-preview card for every blog page:
  the same team icon beside the journal title, description and `tmt.ninja/blog`,
  in the black-only palette with a red top rule, rendered once in headless Chromium.
  SHA-256: `2ae614b15dd9f28246226093116795330bd19dcdf1457d701ce6486e1948b07a`.
- `site/src/blog/share/<slug>.png` is an optional 1200×630 card for one article,
  used instead of `og.png` on that article's pages. `what-one-percent-buys.png`
  charts that article's published dollars per 1% for 27 September to 30 October 2026
  (Ultra, formerly Max 20x, $26–35; Max 5x ~$17; Codex Pro 200 $9.7; Pro 100 $9.5)
  in the same palette.
  SHA-256: `356b46f2f0749757269e8c6fb83cf0c159f8685f76c69a1161cec38c05956658`.

The owner-approved blog home mock (1 November 2026, #5908) supplies the shared
sticky header/footer, index questions, statistics and date/article/key-number rows.
`team-tmt.png` is the supplied rounded team tile used by the shared header; the
existing `mark.svg` remains the favicon. Product and Colab navigation is configured
but hidden until those destinations are published, by the lead's explicit decision.
The owner-supplied X handle links to `https://x.com/tmtTofu` as “Follow on X”.
The committed `stats.json` snapshot carries the mock's as-of date, display values
and source note; build-time validation does not query host activity.

The landing loads canonical design tokens but uses its own layout CSS. Shared
site chrome exposes its own prefixed CSS tokens with site-color fallbacks; blog
article typography retains its independent black-only treatment.
These are committed local adaptations; builds never fetch the product repository.

Upstream TMT source is MIT licensed. See LICENSE for the retained notice.
