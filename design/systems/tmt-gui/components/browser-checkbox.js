// Runtime 4 supplies the real browser-ui checkbox; its native interaction owns the local value.
export default ({ React, ui }) => function BrowserCheckbox({ checked, children, ...props }) {
  const [value, setValue] = React.useState(checked);
  React.useEffect(() => setValue(checked), [checked]);
  return React.createElement(ui.BrowserCheckbox, {
    ...props,
    checked: value,
    onChange: (event) => setValue(event.target.checked),
  });
};
