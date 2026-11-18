export default ({ React, ui }) => function WorkOverview({ counts = '[]', ...props }) {
  let values;
  try { values = JSON.parse(counts); } catch { values = null; }
  if (!Array.isArray(values) || !values.every(value => value && ['working', 'waiting-ci', 'waiting-release', 'blocked', 'needs-you', 'possibly-stalled', 'discussing', 'done', 'unknown', 'unchecked'].includes(value.state) && typeof value.label === 'string' && Number.isSafeInteger(value.count) && value.count >= 0))
    return React.createElement('span', { role: 'alert', 'data-tmt-ds-notice': '' }, 'Invalid counts for work-overview.');
  return React.createElement(ui.WorkOverview, { ...props, counts: values });
};
