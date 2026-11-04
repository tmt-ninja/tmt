// Ports browser-ui's BlockDocument (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part; the part's classes are
// plain names from src/blocks/blocks.css, so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  return function BlockDocument({ children }) {
    return html`<div data-slot="block-doc" className="tmt-block-doc"><div className="tmt-block-doc-body">${children}</div></div>`;
  };
};
