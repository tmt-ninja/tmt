// A thin wrapper over the ChartBlock part: `categories` is a comma list, `series` is
// `name: value, value; name: value, …` with `-` for no value, so a mockup draws a chart from data.
// Values are whole numbers, shown divided by 10^`decimals` (0 to 3).
export default ({ React, ui }) => ({ kind = 'bar', label = 'Chart', categories = '', series = '', max = '', decimals = '' }) => {
  const list = (text) => text.split(',').map((item) => item.trim());
  const labels = categories ? list(categories) : [];
  const layers = series.split(';').filter((part) => part.includes(':')).map((part) => {
    const at = part.indexOf(':');
    const values = list(part.slice(at + 1)).map((value) => (/^\d+(\.\d+)?$/.test(value) ? Number(value) : null));
    return { name: part.slice(0, at).trim(), values: labels.map((_, index) => values[index] ?? null) };
  });
  const top = Number(max);
  const places = Math.min(3, Math.max(0, Math.trunc(Number(decimals)) || 0));
  return React.createElement(ui.ChartBlock, { kind, title: label, categories: labels, series: layers, decimals: places, ...(top > 0 ? { max: top } : {}) });
};
