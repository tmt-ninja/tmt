export default ({ React, ui }) => ({ heading = '', product = 'TMT', caption }) =>
  React.createElement(ui.BrowserHeader, { title: heading, productLabel: product, caption });
