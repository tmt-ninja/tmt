import journal from "../blog/site.json";
import markUrl from "../blog/team-tmt.png";
import type { SiteChromeOptions } from "./site-chrome.mjs";

const settings: { title: string; xHandle?: string } = journal;

// Reuse the marketing-owned mark and configured handle without changing their content.
export function landingChrome(sectionPath: string, homePrefix = ""): SiteChromeOptions {
  const base = new URL(import.meta.env.BASE_URL, location.href).pathname;
  const homeHref = `${base}${homePrefix.replace(/^\//, "")}${homePrefix ? "/" : ""}`;
  return {
    sectionPath,
    brandHref: homeHref,
    markUrl: new URL(markUrl, location.href).pathname,
    links: [
      { label: "Product", url: homeHref, published: true },
      { label: "Journal", url: `${base}blog/`, published: true },
      { label: "Colab", url: `${base}colab/`, published: true },
      { label: "GitHub", url: "https://github.com/tmt-ninja/tmt", published: true, external: true },
    ],
    rssUrl: `${base}blog/feed.xml`,
    xHandle: settings.xHandle,
  };
}
