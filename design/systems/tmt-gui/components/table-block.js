export default ({ React, ui }) => ({ label = 'Table', columns = '', rows = '', 'hide-narrow': hide = '' }) => {
  const hidden = new Set(hide.split(',').map((item) => item.trim()));
  return React.createElement(ui.TableBlock, { label,
    columns: columns.split(',').map((name) => name.trim()).filter(Boolean).map((name) => ({ name, hideNarrow: hidden.has(name) })),
    rows: rows ? rows.split(';').map((row) => row.split('|').map((cell) => cell.trim())) : [] });
};
