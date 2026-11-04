// Ports browser-ui's HeadingBlock (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part composed as `ui.compose` says; the part's classes are
// plain names from src/blocks/blocks.css, so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  return function HeadingBlock({ level = '2', children }) {
    const Tag = level === '3' ? 'h3' : 'h2';
    return html`<${Tag} data-slot="heading-block" className="tmt-block-heading" data-level=${level}>${children}</${Tag}>`;
  };
};
