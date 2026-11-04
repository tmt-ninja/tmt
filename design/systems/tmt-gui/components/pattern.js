// The runtime supplies the 5100 pattern scenes, composed from shared components.
export default ({ React, ui }) => ({ page = 'tabs-row' }) =>
  React.createElement(ui.PatternPage, { page });
