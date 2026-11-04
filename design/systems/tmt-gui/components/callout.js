// Ports browser-ui's Callout (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part composed as `ui.compose` says; the part's classes are
// plain names from src/blocks/blocks.css, so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  const eyebrows = { working: '● Working', waiting: '◆ Waiting on you', review: '◇ In review', blocked: '✗ Blocked' };
  return function Callout({ tone = 'working', eyebrow, heading, children }) {
    return html`<div data-slot="callout" role="note" className="tmt-ui-notice tmt-block-callout" data-tone=${tone} data-tinted="">
      <div className="tmt-ui-notice-eyebrow">${eyebrow ?? eyebrows[tone]}</div>
      ${heading !== undefined && html`<h3 className="tmt-ui-notice-heading">${heading}</h3>`}
      <div className="tmt-ui-notice-body">${children}</div>
    </div>`;
  };
};
