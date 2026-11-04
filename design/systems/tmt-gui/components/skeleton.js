// Runtime 4 supplies the real browser-ui Skeleton.
export default ({ React, ui }) => ({ width = '8rem', height = '1rem' }) => React.createElement(ui.Skeleton, { style: { width, height } });
