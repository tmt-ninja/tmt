export default ({ React, ui }) => function Field({ label = 'Field', placeholder }) {
  const id = React.useId();
  return React.createElement(ui.BrowserField, { controlId: id, label,
    renderControl: (props) => React.createElement('input', { ...props, placeholder }) });
};
