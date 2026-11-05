export default ({ React, ui }) => function PageRow({ label = 'Page', tags = '', updated = '', state, href = '#', unread }) {
  return React.createElement(ui.BrowserPageRow, { title: label, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), updated, state, href, unread });
};
