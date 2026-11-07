// Runtime 4 supplies the real browser-ui ImageBlock. This tag only reads its attributes: the part
// owns the carousel, the viewer and every look, so a page draws exactly what the docs draw.
const reference = /^colab-attachment:(?:[0-9a-f]{8}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;
const list = (text) => {
  try {
    const value = JSON.parse(text || '[]');
    return Array.isArray(value) ? value.slice(0, 100) : [];
  } catch {
    return [];
  }
};
const text = (value) => (typeof value === 'string' ? value : undefined);
const choose = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export default ({ React, ui }) =>
  function ImageBlockTag(props) {
    const images = list(props.images)
      .filter((item) => item && typeof item.src === 'string')
      .map((item) => ({
        src: item.src,
        alt: text(item.alt) ?? '',
        caption: text(item.caption),
        tag: text(item.tag),
        filename: text(item.filename),
        status: choose(item.status, ['loading', 'error'], undefined),
        // The page runtime swaps an attachment reference for its image in place, so a load error
        // before the swap is not a failure.
        hostResolved: reference.test(item.src),
        // A failed load can be tried again; a failure the page itself declared cannot.
        onRetry: item.status === 'error' ? undefined : () => {},
      }));
    const files = list(props.files)
      .filter((item) => item && typeof item.name === 'string')
      .map((item) => ({
        name: item.name,
        size: text(item.size) ?? '',
        type: text(item.type),
        href: reference.test(item.href || '') ? item.href : undefined,
      }));
    return React.createElement(ui.ImageBlock, {
      images,
      files,
      variant: choose(props.variant, ['image', 'file'], 'image'),
      layout: choose(props.layout, ['carousel', 'grid', 'single'], 'carousel'),
      size: choose(props.size, ['s', 'm', 'l'], 'm'),
    });
  };
