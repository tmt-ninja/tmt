export default ({ React, ui }) => ({ heading, state = 'Notice', tone = 'muted', children }) =>
  React.createElement(ui.BrowserNotice, { title: heading, stateLabel: state, tone, announcement: 'none', mark: '●', body: children });
