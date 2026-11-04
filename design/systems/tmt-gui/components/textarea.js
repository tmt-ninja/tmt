// Runtime 4 supplies the real browser-ui Textarea.
export default ({ React, ui }) => ({ children, ...props }) => React.createElement(ui.Textarea, props);
