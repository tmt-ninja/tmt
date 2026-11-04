import favicon from '../generated/favicon.svg?raw';

/** All palettes use the blog's selected favicon, with its original dark tile (#5971). */
export function setPaletteBFavicon() {
  let link = document.querySelector<HTMLLinkElement>('link[rel=icon]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.href = `data:image/svg+xml,${encodeURIComponent(favicon)}`;
}
