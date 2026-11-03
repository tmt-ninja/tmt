// Ports browser-ui's ui Alert and its parts (#5866): plain JavaScript and htm on the skeleton
// (React, html, cn). The compiler fills `classes` from the ui component; every example must draw
// like the ui parts composed as `ui.compose` says.
export default ({ html, cn }) => {
  const classes = /* classes */ null;
  return function Alert({ variant = 'default', heading, children }) {
    return html`<div data-slot="alert" role="alert" className=${cn(classes.base, classes.by[variant])}>
      ${heading !== undefined &&
      html`<div data-slot="alert-title" className=${classes.parts['alert-title']}>${heading}</div>`}
      <div data-slot="alert-description" className=${classes.parts['alert-description']}>${children}</div>
    </div>`;
  };
};
