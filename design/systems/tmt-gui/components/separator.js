// Ports browser-ui's ui Separator (#5866): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler fills `classes` from the ui component; every example must draw like it.
export default ({ html, cn }) => {
  const classes = /* classes */ null;
  return function Separator({ orientation = 'horizontal' }) {
    return html`<div data-slot="separator" data-orientation=${orientation} role="none" className=${cn(classes.base, classes.by[orientation])}></div>`;
  };
};
