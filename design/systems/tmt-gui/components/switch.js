// Ports browser-ui's ui Switch (#5866): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler fills `classes` from the ui component; every example must draw like it, including
// Radix's hidden form input after the control.
export default ({ React, html, cn }) => {
  const classes = /* classes */ null;
  return function Switch({ checked = false, size = 'default', disabled = false, label }) {
    const [on, setOn] = React.useState(checked);
    const state = on ? 'checked' : 'unchecked';
    return html`<${React.Fragment}><button
      type="button"
      role="switch"
      aria-checked=${on}
      aria-label=${label}
      data-state=${state}
      value="on"
      data-slot="switch"
      data-size=${size}
      disabled=${disabled}
      className=${cn(classes.base, classes.by[size])}
      onClick=${() => setOn(!on)}
    >
      <span data-state=${state} data-slot="switch-thumb" className=${classes.slots['switch-thumb']}></span>
    </button><input
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
