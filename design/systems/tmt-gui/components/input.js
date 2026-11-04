// Runtime 4 supplies the real browser-ui Input.
export default ({ React, ui }) => ({ children, ...props }) => React.createElement(ui.Input, props);
