// Ports browser-ui's ui Surface (#5866): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler fills `classes` from the ui component; every example must draw like it.
export default ({ html, cn }) => {
  const classes = /* classes */ null;
  return function Surface({ level = 'sheet', children }) {
    return html`<div data-slot="surface" data-level=${level} className=${cn(classes.base, classes.by[level])}>${children}</div>`;
  };
};
