// Ports browser-ui's ui Empty and its parts (#5866): plain JavaScript and htm on the skeleton
// (React, html, cn). The compiler fills `classes` from the ui component; every example must draw
// like the ui parts composed as `ui.compose` says.
export default ({ html }) => {
  const classes = /* classes */ null;
  const part = (slot, content) =>
    html`<div data-slot=${slot} className=${classes.parts[slot]}>${content}</div>`;
  return function Empty({ heading, description, icon, children }) {
    return html`<div data-slot="empty" className=${classes.base}>
      <div data-slot="empty-header" className=${classes.parts['empty-header']}>
        ${icon !== undefined && part('empty-icon', icon)}
        ${part('empty-title', heading)}
        ${description !== undefined && part('empty-description', description)}
      </div>
      ${children !== undefined && part('empty-content', children)}
    </div>`;
  };
};
