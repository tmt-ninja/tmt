// Runtime 4 supplies the real Tooltip and its originating theme.
export default ({ React, ui }) => function Tooltip({ label = 'Help', children }) {
  const h = React.createElement;
  return h(ui.UiTheme, null, h(ui.TooltipProvider, null, h(ui.Tooltip, null,
    h(ui.TooltipTrigger, { asChild: true }, h(ui.Button, { variant: 'outline' }, label)),
    h(ui.TooltipContent, null, children))));
};
