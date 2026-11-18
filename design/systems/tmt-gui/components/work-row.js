export default ({ React, ui }) => function WorkRow({label, ...props}) {
  return React.createElement(ui.WorkRow, {...props, title: label});
};
