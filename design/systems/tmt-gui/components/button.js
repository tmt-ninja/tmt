// The renderer supplies the real browser-ui Button on the page runtime's React.
export default ({ React, ui }) => {
  return function Button({ icon, children, 'busy-label': busyLabel, 'collapse-label': collapseLabel, ...props }) {
    return React.createElement(ui.Button, { ...props, busyLabel, collapseLabel }, icon, children);
  };
};
