// The real BrowserAction sends its native click through the custom element.
export default ({ React, ui }) => ({ label = '', variant = 'secondary', children, ...props }) =>
  React.createElement(ui.BrowserAction, { ...props, label, variant, type: 'button', busyMark: React.createElement(ui.BusyMark), onActivate: () => {} });
