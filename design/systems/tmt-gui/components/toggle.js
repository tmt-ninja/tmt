// The BrowserToggle keeps its local pressed state while the page observes native clicks.
export default ({ React, ui }) => function Toggle({ label = '', pressed, children, ...props }) {
  const [value, setValue] = React.useState(pressed);
  React.useEffect(() => setValue(pressed), [pressed]);
  return React.createElement(ui.BrowserToggle, {
    ...props,
    label,
    pressed: value,
    onActivate: () => setValue((current) => !current),
  });
};
