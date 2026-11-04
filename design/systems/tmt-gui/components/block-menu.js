// Ports browser-ui's BlockMenu (the insert menu and the block menu) (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part composed as `ui.compose` says; the part's classes are
// plain names from src/blocks/blocks.css, so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  const kbd = (text) => html`<kbd className="tmt-block-kbd">${text}</kbd>`;
  return function BlockMenu({ label, kind = 'insert', placement = 'below', items = '', active, hints }) {
    const names = String(items).split(',').map((item) => item.trim()).filter(Boolean);
    const on = active ?? names[0];
    return html`<div data-slot="block-menu" role=${kind === 'insert' ? 'listbox' : 'menu'} aria-label=${label} data-placement=${placement} tabIndex="-1" className="tmt-block-menu">
      ${names.map(
        (name) => html`<div key=${name} data-slot="block-menu-item" role=${kind === 'insert' ? 'option' : 'menuitem'} aria-selected=${kind === 'insert' ? String(name === on) : undefined} data-active=${name === on ? '' : undefined} className="tmt-block-menu-item"><span className="tmt-block-menu-label">${name}</span></div>`,
      )}
      ${hints && html`<div data-slot="block-menu-footer" aria-hidden="true" className="tmt-block-menu-footer"><span>${kbd('↑↓')} choose</span><span>${kbd('Enter')} insert</span><span>${kbd('Esc')} close</span></div>`}
    </div>`;
  };
};
