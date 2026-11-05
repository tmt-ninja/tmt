// This tag renders the real browser-ui BrowserAvatar supplied by runtime 4.
export default ({ React, ui }) => ({ name = '', ...props }) =>
  React.createElement(ui.BrowserAvatar, { ...props, name });
