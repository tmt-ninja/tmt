// The real DataTable receives a small page-authored projection.
export default ({ React, ui }) => ({ label = 'Table', columns = 'Name', rows = '' }) => {
  const headings = columns.split(',').map((value) => value.trim()).filter(Boolean);
  const entries = rows ? rows.split(';').map((row, id) => ({ id: String(id), cells: row.split(',').map((value) => value.trim()) })) : [];
  const fields = headings.map((header, index) => ({ id: String(index), header, role: index === 0 ? 'primary' : 'text', text: (row) => row.cells[index] ?? '' }));
  return React.createElement(ui.UiTheme, null, React.createElement(ui.DataTable, { label, rows: entries, columns: fields,
    rowKey: (row) => row.id, rowLabel: (row) => row.cells[0] ?? '' }));
};
