// The renderer supplies the real browser-ui Button on the page runtime's React.
export default ({ React, ui }) => {
  return function Button({ icon, children, ...props }) {
    return React.createElement(ui.Button, props, icon, children);
  };
};
