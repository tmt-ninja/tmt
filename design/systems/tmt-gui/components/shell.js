// The real shell renders the page-authored rail inside its originating stage.
export default ({ React, ui }) => function Shell({ items = 'Colab,Design', children }) {
  const main = items.split(',').map((item) => item.trim()).filter(Boolean).map((label, index) => ({
    id: String(index), label, icon: 'box', href: '#', current: index === 0,
  }));
  return React.createElement(ui.UiTheme, null, React.createElement(ui.BrowserShell,
    { view: { rail: { main, bottom: [] } }, select: () => true }, children));
};
