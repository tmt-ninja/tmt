// Ports browser-ui's Block shell and its one shared handle (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part composed as `ui.compose` says; the part's classes are
// plain names from src/blocks/blocks.css, so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  const handleButton = (label, icon, grip) =>
    html`<button type="button" tabIndex="-1" className="tmt-block-handle-button" data-grip=${grip ? '' : undefined} aria-label=${label} aria-haspopup=${grip ? 'menu' : undefined} aria-expanded=${grip ? 'false' : undefined}>${icon}</button>`;
  return function Block({ label, kind, state, selected, readonly, handle, children }) {
    return html`<div data-slot="block" role="group" aria-label=${selected && label ? `${label}, selected` : label} data-selected=${selected ? '' : undefined} data-kind=${kind} data-state=${state && state !== 'idle' ? state : undefined} data-readonly=${readonly ? '' : undefined} className="tmt-block">
      ${handle && html`<div data-slot="block-handle" className="tmt-block-handle">${handleButton('Insert block', html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-plus" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>`)}${handleButton('Block actions', html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-grip-vertical" aria-hidden="true"><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>`, true)}</div>`}
      ${children}
    </div>`;
  };
};
