// The runtime supplies the same live foundation articles used by the design-system docs.
export default ({ React, ui }) => ({ page = 'colour' }) =>
  React.createElement(ui.FoundationPage, { page });
