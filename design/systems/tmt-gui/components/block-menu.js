export default ({ React, ui }) => ({ label = 'Blocks', kind = 'insert', placement, items = '', active, hints }) => {
  const h = React.createElement;
  const names = items.split(',').map((item) => item.trim()).filter(Boolean);
  // BlockMenu draws catalog rows by label or `id:text` (the row of that id showing `text`): an
  // insert type's icon, description, shortcut and group, or a block action's key. `group:id:text`
  // renames a group heading; any other entry is a plain row.
  return h(ui.BlockMenu, { label, kind, placement, items: names, activeItem: active ?? names[0] },
    hints && h(ui.BlockMenuFooter, null, h('span', null, h(ui.BlockKbd, null, '↑↓'), ' choose'),
      h('span', null, h(ui.BlockKbd, null, 'Enter'), ' insert'), h('span', null, h(ui.BlockKbd, null, 'Esc'), ' close')));
};
