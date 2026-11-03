// The Button component doc's source (schema 1): plain JavaScript and htm, no imports. It receives
// the fixed skeleton (runtime 2: React, html, cn) and returns the component. It ports browser-ui's
// ui Button; the compiler fills `classes` from that component's own variants (#5866).
export default ({ html, cn }) => {
  const classes = /* classes */ null;
  return function Button({ variant = 'default', size = 'default', disabled = false, icon, children }) {
    return html`<button
      type="button"
      data-slot="button"
      data-variant=${variant}
      data-size=${size}
      className=${cn(classes.base, classes.by[`${variant}|${size}`])}
      disabled=${disabled}
      aria-disabled=${disabled || undefined}
    >
      ${icon}${children}
    </button>`;
  };
};
