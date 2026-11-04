// Ports browser-ui's Callout (the shared BrowserNotice, tinted, as a note) (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part composed as `ui.compose` says; the part's classes are
// plain names from src/blocks/blocks.css, so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  const labels = { working: ['●', 'Working'], waiting: ['◆', 'Waiting on you'], review: ['◇', 'In review'], blocked: ['✗', 'Blocked'] };
  return function Callout({ tone = 'working', label, heading, children }) {
    const [mark, word] = labels[tone];
    return html`<div data-slot="callout" className="tmt-block-callout">
      <section className="tmt-ui-notice" data-tone=${tone} data-tinted="" role="note">
        <div className="tmt-ui-notice-mark"><span aria-hidden="true">${mark}</span><span>${label ?? word}</span></div>
        ${heading !== undefined && html`<h3 className="tmt-ui-notice-heading">${heading}</h3>`}
        <div className="tmt-ui-notice-body">${children}</div>
      </section>
    </div>`;
  };
};
