export default ({ React, ui }) => ({ handle, children, label = 'Block', ...props }) =>
  React.createElement(ui.Block, { ...props, label }, handle && React.createElement(ui.BlockHandle), children);
