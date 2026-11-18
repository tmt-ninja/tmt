export default ({ React, ui }) => function WorkNextLine({ titles = '[]', ...props }) {
  let values;
  try { values = JSON.parse(titles); } catch { values = null; }
  if (!Array.isArray(values) || !values.every(value => typeof value === 'string'))
    return React.createElement('span', { role: 'alert', 'data-tmt-ds-notice': '' }, 'Invalid titles for work-next-line.');
  return React.createElement(ui.WorkNextLine, { ...props, titles: values });
};
