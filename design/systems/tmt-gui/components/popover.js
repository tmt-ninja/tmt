// Runtime 4 supplies the real browser-ui layer components.
export default ({ React, ui }) => function Popover({ label = 'Open popover', children }) {
  const h = React.createElement;
  return h(ui.UiTheme, null, h(ui.Popover, null, h(ui.PopoverTrigger, { asChild: true }, h(ui.Button, { variant: 'outline' }, label)),
    h(ui.PopoverContent, null, children)));
};
