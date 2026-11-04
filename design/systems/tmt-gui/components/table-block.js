// The TableBlock (#5981), unported: its columns and rows are text lists, which the drift check
// cannot compose. Plain JavaScript and htm on the skeleton (React, html, cn), drawing browser-ui's
// TableBlock: the shared BrowserTable, whose first column holds the row headings.
export default ({ html }) => {
  const list = (text, by) => String(text ?? '').split(by).map((item) => item.trim()).filter(Boolean);
  return function TableBlock({ label, columns, rows, 'hide-narrow': hideNarrow }) {
    const names = list(columns, ',');
    const hidden = new Set(list(hideNarrow, ','));
    const cell = (index) => (hidden.has(names[index]) ? '' : undefined);
    return html`<div data-slot="table-block" className="tmt-block-table">
      <table className="tmt-ui-table" aria-label=${label}>
        <thead><tr>${names.map((name, index) => html`<th key=${name} scope="col" data-hide-narrow=${cell(index)}>${name}</th>`)}</tr></thead>
        <tbody>${list(rows, ';').map((row, at) => html`<tr key=${at}>${row.split('|').map((value, index) =>
          index === 0
            ? html`<th key=${index} scope="row" data-hide-narrow=${cell(index)}>${value.trim()}</th>`
            : html`<td key=${index} data-hide-narrow=${cell(index)}>${value.trim()}</td>`,
        )}</tr>`)}</tbody>
      </table>
    </div>`;
  };
};
