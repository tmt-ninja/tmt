export default ({ React, ui }) => function Todo({ checked, children, ...props }) {
  const [value, setValue] = React.useState(checked);
  React.useEffect(() => setValue(checked), [checked]);
  return React.createElement(ui.TodoBlock, { ...props, checked: value, label: 'To-do', onCheckedChange: setValue }, children);
};
