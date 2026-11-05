export default ({ React, ui }) => ({ label = 'Count', count, children, ...props }) =>
  React.createElement(ui.BrowserCountChip, { ...props, label, count: count === undefined ? undefined : Number(count), icon: children, onActivate: () => {} });
