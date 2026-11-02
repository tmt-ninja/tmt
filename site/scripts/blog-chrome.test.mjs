import test from "node:test";
import assert from "node:assert/strict";
import { siteChrome } from "../src/shared/site-chrome.mjs";
import { stats, validateStats } from "../src/blog/stats.mjs";

const config = {
  sectionPath: "~/journal",
  brandHref: "/tmt/blog/",
  markUrl: "/tmt/blog/team-tmt.png",
  rssUrl: "/tmt/blog/feed.xml",
  links: [
    { label: "Product", url: "/tmt/", published: false },
    { label: "Journal", url: "/tmt/blog/", published: true },
    { label: "Colab", url: "/tmt/colab/", published: false },
    { label: "GitHub", url: "https://github.com/team/repo", published: true },
  ],
};
test("shared chrome hides unpublished destinations and adds X only for a configured handle", () => {
  const { header, footer } = siteChrome(config);
  assert.match(header, /~\/journal/);
  assert.match(header, /team-tmt\.png/);
  assert.doesNotMatch(header, />Product<|>Colab<|Follow on/);
  assert.match(header, />Journal</);
  assert.match(footer, /mailto:tofu@tmt.ninja/);
  assert.match(footer, /Tools for people and agents/);
  assert.match(footer, /\/tmt\/blog\/feed.xml/);
  const enabled = siteChrome({
    ...config,
    xHandle: "tmt_ninja",
    links: config.links.map((link) => ({ ...link, published: true })),
  });
  assert.match(enabled.header, />Product</);
  assert.match(enabled.header, />Colab</);
  for (const value of Object.values(enabled))
    assert.match(value, /href="https:\/\/x.com\/tmt_ninja">Follow on X/);
});
test("shared chrome escapes labels and paths and rejects unsafe or ambiguous configuration", () => {
  const { header } = siteChrome({
    ...config,
    sectionPath: "<journal&>",
    links: [{ label: "<News&>", url: "/blog/?a=1&b=2", published: true }],
  });
  assert.match(header, /&lt;journal&amp;&gt;/);
  assert.match(header, /&lt;News&amp;&gt;/);
  assert.match(header, /a=1&amp;b=2/);
  for (const xHandle of [null, "", "@handle", "bad/handle", "x".repeat(16)])
    assert.throws(() => siteChrome({ ...config, xHandle }), /X handle/);
  for (const url of [
    "javascript:alert(1)",
    "//example.com/",
    "/\\example.com",
    "https://example.com/a b",
  ])
    assert.throws(
      () => siteChrome({ ...config, links: [{ label: "Hidden", url, published: false }] }),
      /links require/,
    );
  assert.throws(
    () => siteChrome({ ...config, links: [{ label: "News", url: "/news/" }] }),
    /published boolean/,
  );
});
test("stats require a dated, complete, bounded snapshot", () => {
  assert.equal(validateStats(stats), stats);
  const changes = [
    (v) => {
      v.asOf = "2026-02-30";
    },
    (v) => {
      delete v.note;
    },
    (v) => {
      v.extra = true;
    },
    (v) => {
      v.metrics.pop();
    },
    (v) => {
      v.metrics[0].value = "";
    },
    (v) => {
      v.metrics[1].id = "subscriptions";
    },
    (v) => {
      v.note = "bad\ntext";
    },
  ];
  for (const change of changes) {
    const value = structuredClone(stats);
    change(value);
    assert.throws(() => validateStats(value), /Invalid blog stats/);
  }
});
