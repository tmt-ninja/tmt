export default ({ React, ui }) => ({ label = 'Action', disabled, children }) =>
  React.createElement(ui.BrowserIconAction, { label, disabled, type: 'button', variant: 'secondary', icon: children, onActivate: () => {} });
