// Compose the real browser-ui Empty parts supplied by runtime 4.
export default ({ React, ui }) => function Empty({ heading, description, icon, children }) {
  const h = React.createElement;
  return h(ui.Empty, null, h(ui.EmptyHeader, null,
    icon !== undefined && h(ui.EmptyMedia, null, icon),
    h(ui.EmptyTitle, null, heading),
    description !== undefined && h(ui.EmptyDescription, null, description)),
    children !== undefined && h(ui.EmptyContent, null, children));
};
