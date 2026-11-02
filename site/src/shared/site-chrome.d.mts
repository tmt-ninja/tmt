export interface SiteChromeLink {
  label: string;
  url: string;
  published: boolean;
  external?: boolean;
}
export interface SiteChromeOptions {
  sectionPath: string;
  brandHref: string;
  markUrl: string;
  links: SiteChromeLink[];
  rssUrl: string;
  xHandle?: string;
  controls?: boolean;
}
export function siteChrome(options: SiteChromeOptions): { header: string; footer: string };
