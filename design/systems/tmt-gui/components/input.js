// Ports browser-ui's ui Input (#5866): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler fills `classes` from the ui component; every example must draw like it.
export default ({ html }) => {
  const classes = /* classes */ null;
  return function Input({ type = 'text', placeholder, disabled = false }) {
    return html`<input type=${type} data-slot="input" placeholder=${placeholder} disabled=${disabled} className=${classes.base} />`;
  };
};
