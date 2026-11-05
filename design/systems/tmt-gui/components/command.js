// Compose the real command palette parts on the page runtime's React.
export default ({ React, ui }) => function Command({ label = 'Search', items = '', query = '' }) {
  const h = React.createElement;
  const [search, setSearch] = React.useState(query);
  const choices = items.split(',').map((item) => item.trim()).filter(Boolean);
  const row = (item, index) => {
    // `page:title:meta` uses the same id:text convention as BlockMenu. Invalid entries stay text.
    const match = /^page:([^:]+):(.+)$/.exec(item);
    const title = match?.[1]?.trim();
    const meta = match?.[2]?.trim();
    if (!title || !meta) return h(ui.CommandItem, { key: `${index}:${item}`, value: item }, item);
    return h(ui.CommandItem, { key: `${index}:${item}`, value: `${title} ${meta}` },
      h('tmt-icon', { name: 'file-text', 'aria-hidden': 'true' }),
      h('span', { className: 'tmt-ui-list-title' },
        h('span', { className: 'tmt-ui-list-label' }, title),
        h('span', { className: 'tmt-ui-list-description' }, meta)));
  };
  return h(ui.Command, { label }, h(ui.CommandInput, { placeholder: label, 'aria-label': label, value: search, onValueChange: setSearch }),
    h(ui.CommandList, null, ...choices.map(row)));
};
