// The real browser-ui Tabs parts own keyboard and selection behavior.
export default ({ React, ui }) => function Tabs({ items = '', value, actions, children }) {
  const list = items.split(',').map((item) => item.trim()).filter(Boolean);
  const [selected, setSelected] = React.useState(value ?? list[0]);
  React.useEffect(() => { if (value !== undefined) setSelected(value); }, [value]);
  const h = React.createElement;
  const tabList = h(ui.TabsList, null, ...list.map((item) => h(ui.TabsTrigger, { key: item, value: item }, item)));
  return h(ui.Tabs, { value: selected, onValueChange: setSelected },
    actions ? h(ui.TabsBar, { actions }, tabList) : tabList,
    children);
};
