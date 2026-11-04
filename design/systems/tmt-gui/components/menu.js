export default ({ React, ui }) => ({ label = 'Options', items = '' }) =>
  React.createElement(ui.BrowserMenu, { label, triggerText: label,
    items: items.split(',').map((item) => item.trim()).filter(Boolean).map((item) => ({ key: item, label: item })),
    onSelect: () => {} });
