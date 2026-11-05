// The real Chips control owns its layer; the example keeps a local selection.
export default ({ React, ui }) => {
  const h = React.createElement;
  function Control({ label, choices }) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [items, setItems] = React.useState([]);
    const controller = ui.useLayerController({ open, onOpenChange: setOpen });
    const options = choices.filter((name) => !items.includes(name) && name.toLowerCase().includes(query.toLowerCase()))
      .map((name) => ({ id: name, label: name }));
    return h(ui.Chips, { label, controller, query, onQueryChange: setQuery, options,
      emptyLabel: 'No matches', items: items.map((name) => ({ id: name, label: name, removeLabel: `Remove ${name}` })),
      onAdd: (option) => { setItems((current) => [...current, option.id]); setQuery(''); },
      onRemove: (item) => setItems((current) => current.filter((name) => name !== item.id)) });
  }
  return ({ label = 'People', items = '' }) => h(ui.UiTheme, null,
    h(Control, { label, choices: items.split(',').map((item) => item.trim()).filter(Boolean) }));
};
