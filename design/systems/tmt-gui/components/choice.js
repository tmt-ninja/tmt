export default ({ React, ui }) => function Choice({ label = '', type = 'checkbox', checked, children, ...props }) {
  const [value, setValue] = React.useState(checked);
  React.useEffect(() => setValue(checked), [checked]);
  return React.createElement(ui.BrowserChoice, { ...props, label, type, checked: value, onChange: (event) => setValue(event.target.checked) });
};
