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
- `site/src/blog/mark.svg` is the hand-built Wrapped ninja selected by Ben for #5945.
  Its hood, rounded terminal prompt, oval face and scarf were redrawn from the
  selected image-generation concept and refined in the shared Colab page. The
  fixed rice-paper fill makes the external SVG visible on the dark blog header.
  Its square viewBox adds the equivalent of #5979's 11.5-unit inset around a
  73-unit artwork viewport in a 96-unit tile (Ben's 12% choice, #5983). The
  underlying paths are unchanged; the 30px header matches the product mark.
  SHA-256: `517aa33d0e80920faf50c6343d86838d9fd155d3add49a4aa1c4fb8c84eb4188`.
- `site/src/blog/favicon.png` is a raster rendering of the same mark on a black
  rounded square, used for both the tab and touch icon. It is rendered at
  192×192 from the padded SVG, with no additional inset and a 51.2px corner
  radius, matching the product tile's 25.6-unit radius in a 96-unit viewport.
  SHA-256: `8b662538017fa34c69e109f378bdbde407dce938bc5ac6bef8ddb81e2378a5a0`.
- `site/src/blog/og.png` is the 1200×630 link-preview card for every blog page:
  the earlier team icon beside the journal title, description and `tmt.ninja/blog`,
  in the black-only palette with a red top rule, rendered once in headless Chromium.
  SHA-256: `2ae614b15dd9f28246226093116795330bd19dcdf1457d701ce6486e1948b07a`.
- `site/src/blog/share/<slug>.png` is an optional 1200×630 card for one article,
  used instead of `og.png` on that article's pages. `what-one-percent-buys.png`
  charts that article's published dollars per 1% for 27 September to 30 October 2026
  (Ultra, formerly Max 20x, $26–35; Max 5x ~$17; Codex Pro 200 $9.7; Pro 100 $9.5)
  in the same palette.
  SHA-256: `356b46f2f0749757269e8c6fb83cf0c159f8685f76c69a1161cec38c05956658`.
  `shugyo-week-1.png` plots that article's Claude weekly allowance for 28 October to
  3 November 2026 with its Sunday forecast fork and "30% → 12%" in the same palette.
  SHA-256: `2de8fcaace675f4c4a46c2c51831d992b4177c63c657e849442143363b4fef9b`.
  `half-the-token-price.png` charts that article's high-effort Terra ÷ Sol ratios for
  23–30 October 2026 (2.9× tokens per line, 3.9× lead fixes, 1.0× dollars per
  1,000 lines) in the same palette.
  SHA-256: `3a504e07330556580e3d3b76d51788c1f6264bbe85424453233645476f5c74f5`.

The owner-approved blog home mock (1 November 2026, #5908) supplies the shared
sticky header/footer, index questions, statistics and date/article/key-number rows.
The selected Wrapped mark replaces the earlier team tile in the blog header.
Product and Colab navigation is configured but hidden until those destinations
are published, by the lead's explicit decision.
The owner-supplied X handle links to `https://x.com/tmtTofu` as “Follow on X”.
The committed `stats.json` snapshot is refreshed by `stats-update.mjs` (see the
site README); build-time validation does not query host activity.

The landing loads canonical design tokens but uses its own layout CSS. Shared
site chrome exposes its own prefixed CSS tokens with site-color fallbacks; blog
article typography retains its independent black-only treatment.
These are committed local adaptations; builds never fetch the product repository.

Upstream TMT source is MIT licensed. See LICENSE for the retained notice.
