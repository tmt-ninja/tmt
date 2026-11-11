/** The Design docs chrome as text (#6272): the generated docs stylesheet, scoped to `.tmt-design-docs`.
 * Its own module so the page renderer reads it only for a page that draws in that wrapper. */
import docsChrome from '@tmt/browser-ui/docs-embed.css?inline';

export default docsChrome;
