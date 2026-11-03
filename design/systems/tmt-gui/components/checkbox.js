// Ports browser-ui's ui Checkbox (#5866): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler fills `classes` from the ui component; every example must draw like it, including
// Radix's hidden form input after the control.
export default ({ React, html }) => {
  const classes = /* classes */ null;
  return function Checkbox({ checked = false, disabled = false, label }) {
    const [on, setOn] = React.useState(checked);
    return html`<${React.Fragment}><button
      type="button"
      role="checkbox"
      aria-checked=${on}
      aria-label=${label}
      data-state=${on ? 'checked' : 'unchecked'}
      value="on"
      data-slot="checkbox"
      disabled=${disabled}
      className=${classes.base}
      onClick=${() => setOn(!on)}
    ></button><input
      type="checkbox"
      aria-hidden="true"
      tabIndex="-1"
      style=${{ position: 'absolute', pointerEvents: 'none', opacity: 0, margin: 0, transform: 'translateX(-100%)' }}
      checked=${on}
      readOnly
      value="on"
    /><//>`;
  };
};
