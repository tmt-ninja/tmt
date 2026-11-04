export default ({ React, ui }) => ({ label = 'Count', count }) =>
  React.createElement(ui.BrowserCountChip, { label, count: count === undefined ? undefined : Number(count), onActivate: () => {} });
