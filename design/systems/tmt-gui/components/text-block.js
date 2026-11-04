// Ports browser-ui's TextBlock (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part composed as `ui.compose` says; the part's classes are
// plain names from src/blocks/blocks.css, so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  return function TextBlock({ tone = 'default', children }) {
    return html`<p data-slot="text-block" className="tmt-block-text" data-tone=${tone === 'muted' ? 'muted' : undefined}>${children}</p>`;
  };
};
