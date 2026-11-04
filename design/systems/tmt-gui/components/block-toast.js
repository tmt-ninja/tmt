// Ports browser-ui's BlockToast (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part composed as `ui.compose` says; the part's classes are
// plain names from src/blocks/blocks.css, so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  return function BlockToast({ undo = 'Undo', shortcut = '⌘Z', children }) {
    return html`<div data-slot="block-toast" role="status" className="tmt-block-toast">
      <span className="tmt-block-toast-message">${children}</span>
      <button type="button" className="tmt-block-toast-undo">${undo}</button>
      ${shortcut && html`<kbd className="tmt-block-kbd" aria-hidden="true">${shortcut}</kbd>`}
    </div>`;
  };
};
