// Ports browser-ui's ui Textarea (#5866): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler fills `classes` from the ui component; every example must draw like it.
export default ({ html }) => {
  const classes = /* classes */ null;
  return function Textarea({ placeholder, disabled = false }) {
    return html`<textarea data-slot="textarea" placeholder=${placeholder} disabled=${disabled} className=${classes.base}></textarea>`;
  };
};
