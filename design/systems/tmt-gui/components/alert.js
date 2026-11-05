// Compose the real browser-ui Alert parts supplied by runtime 4.
export default ({ React, ui }) => function Alert({ variant, heading, children }) {
  const h = React.createElement;
  return h(ui.Alert, { variant }, heading !== undefined && h(ui.AlertTitle, null, heading),
    h(ui.AlertDescription, null, children));
};
