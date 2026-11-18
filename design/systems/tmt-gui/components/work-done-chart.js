export default ({ React, ui }) => function WorkDoneChart({ cells = '[]', ...props }) {
  let values;
  try { values = JSON.parse(cells); } catch { values = null; }
  if (!Array.isArray(values) || !values.every(value => value && typeof value.label === 'string' && Number.isSafeInteger(value.count) && value.count >= 0 && (value.current === undefined || typeof value.current === 'boolean')))
    return React.createElement('span', { role: 'alert', 'data-tmt-ds-notice': '' }, 'Invalid cells for work-done-chart.');
  return React.createElement(ui.WorkDoneChart, { ...props, cells: values });
};
