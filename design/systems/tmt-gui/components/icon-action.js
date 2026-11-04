export default ({ React, ui }) => ({ label = 'Action', variant = 'secondary', children, ...props }) =>
  React.createElement(ui.BrowserIconAction, { ...props, label, type: 'button', variant, icon: children, busyMark: React.createElement(ui.BusyMark), onActivate: () => {} });
