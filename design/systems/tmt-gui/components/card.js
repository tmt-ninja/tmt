// Ports browser-ui's ui Card and its parts (#5866): plain JavaScript and htm on the skeleton
// (React, html, cn). The compiler fills `classes` from the ui component; every example must draw
// like the ui parts composed as `ui.compose` says.
export default ({ html }) => {
  const classes = /* classes */ null;
  const part = (slot, content) =>
    html`<div data-slot=${slot} className=${classes.parts[slot]}>${content}</div>`;
  return function Card({ heading, description, action, footer, children }) {
    return html`<div data-slot="card" className=${classes.base}>
      ${heading !== undefined &&
      html`<div data-slot="card-header" className=${classes.parts['card-header']}>
        ${part('card-title', heading)}
        ${description !== undefined && part('card-description', description)}
        ${action !== undefined && part('card-action', action)}
      </div>`}
      ${part('card-content', children)}
      ${footer !== undefined && part('card-footer', footer)}
    </div>`;
  };
};
