// Ports browser-ui's ui Badge (#5866): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler fills `classes` from the ui component; every example must draw like it.
export default ({ html, cn }) => {
  const classes = /* classes */ null;
  return function Badge({ variant = 'default', children }) {
    return html`<span data-slot="badge" data-variant=${variant} className=${cn(classes.base, classes.by[variant])}>${children}</span>`;
  };
};
