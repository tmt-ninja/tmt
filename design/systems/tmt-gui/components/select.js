// Runtime 4 supplies the real Select and its parts.
export default ({ React, ui }) => function Select({ label = 'Select', items = '' }) {
  const h = React.createElement;
  const choices = items.split(',').map((item) => item.trim()).filter(Boolean);
  return h(ui.UiTheme, null, h(ui.Select, null,
    h(ui.SelectTrigger, { 'aria-label': label }, h(ui.SelectValue, { placeholder: label })),
    h(ui.SelectContent, null, ...choices.map((item) => h(ui.SelectItem, { key: item, value: item }, item)))));
};
