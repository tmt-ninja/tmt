export default ({ React, ui }) => ({ heading = 'Measure', value = '0', children }) =>
  React.createElement(ui.BrowserCardMeter, { heading, value: Number(value) }, children);
