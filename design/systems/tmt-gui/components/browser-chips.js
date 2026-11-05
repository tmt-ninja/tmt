// The real BrowserChips control keeps its example's selection locally.
export default ({ React, ui }) => function BrowserChips({ label = 'People', items = '' }) {
  const [selected, setSelected] = React.useState([]);
  const [query, setQuery] = React.useState('');
  const options = items.split(',').map((item) => item.trim()).filter(Boolean)
    .filter((item) => !selected.includes(item) && item.toLowerCase().includes(query.toLowerCase()))
    .map((item) => ({ id: item, label: item }));
  return React.createElement(ui.BrowserChips, { label, query, onQueryChange: setQuery, options,
    items: selected.map((item) => ({ id: item, label: item, removeLabel: `Remove ${item}` })),
    addLabel: 'Add', searchLabel: 'Search', emptyText: 'No matches',
    onAdd: (id) => { setSelected((current) => [...current, id]); setQuery(''); },
    onRemove: (id) => setSelected((current) => current.filter((item) => item !== id)) });
};
