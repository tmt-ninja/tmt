// Framework-free site chrome. Callers own routes and publication decisions.
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function linkUrl(value) {
  if (
    typeof value !== "string" ||
    !(/^\/(?!\/)/.test(value) || value.startsWith("https://")) ||
    /[\s\\]/.test(value)
  )
    throw new Error("Site chrome links require a local absolute path or HTTPS URL");
  return escape(value);
}

export function siteChrome({ sectionPath, brandHref, markUrl, links, rssUrl, xHandle }) {
  if (
    !Array.isArray(links) ||
    links.some(
      (item) =>
        !item ||
        typeof item.label !== "string" ||
        !item.label.trim() ||
        typeof item.published !== "boolean",
    )
  )
    throw new Error("Site chrome links require label, URL and published boolean");
  // Validate hidden destinations too: publishing a page must not activate an unsafe URL.
  const visible = links
    .map((item) => ({ ...item, href: linkUrl(item.url) }))
    .filter((item) => item.published);
  if (
    xHandle !== undefined &&
    (typeof xHandle !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(xHandle))
  )
    throw new Error("X handle must contain 1–15 letters, digits or underscores");
  const x = xHandle
    ? `<a class="site-chrome-follow" href="https://x.com/${escape(xHandle)}">Follow on X</a>`
    : "";
  const nav = visible
    .map(
      ({ label, href }) =>
        `<a href="${href}">${escape(label)}${label === "GitHub" ? " ↗" : ""}</a>`,
    )
    .join("");
  const github = visible
    .filter(({ label }) => label === "GitHub")
    .map(({ href }) => `<a href="${href}">GitHub ↗</a>`)
    .join("");
  return {
    header: `<header class="site-chrome-header" lang="en"><a class="site-chrome-brand" href="${linkUrl(brandHref)}"><img vite-ignore src="${linkUrl(markUrl)}" width="30" height="30" alt=""><b>tmt</b><span class="site-chrome-path">${escape(sectionPath)}<span class="site-chrome-cursor" aria-hidden="true"></span></span></a><nav class="site-chrome-nav" aria-label="Main">${nav}${x}</nav></header>`,
    footer: `<footer class="site-chrome-footer" lang="en"><span><b>tmt</b> · Tools for people and agents.</span><nav aria-label="Footer"><a class="site-chrome-mail" href="mailto:tofu@tmt.ninja">tofu@tmt.ninja</a>${x}${github}<a href="${linkUrl(rssUrl)}">RSS ↗</a></nav></footer>`,
  };
}
