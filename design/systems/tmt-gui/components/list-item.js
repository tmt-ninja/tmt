export default ({ React, ui }) => ({ number, indent, ...props }) =>
  React.createElement(ui.ListItemBlock, { ...props, number: number === undefined ? undefined : Number(number), indent: indent === undefined ? undefined : Number(indent) });
