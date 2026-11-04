// Ports browser-ui's ui Tabs (#5866), the default (filled) list: plain JavaScript and htm on the
// skeleton (React, html, cn). The compiler fills `classes` from the ui parts drawn as `ui.sample`;
// every example must draw like the ui parts composed as `ui.compose` says. The line list's
// sliding indicator needs layout, so it is not ported yet.
export default ({ React, html }) => {
  const classes = /* classes */ null;
  return function Tabs({ items = '', value, children }) {
    const list = items
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const [selected, setSelected] = React.useState(value ?? list[0]);
    return html`<div dir="ltr" data-orientation="horizontal" data-slot="tabs" className=${classes.base}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        data-slot="tabs-list"
        data-variant="default"
        data-orientation="horizontal"
        className=${classes.slots['tabs-list']}
      >
        ${list.map(
          (item) =>
            html`<button
              key=${item}
              type="button"
              role="tab"
              aria-selected=${item === selected}
              data-state=${item === selected ? 'active' : 'inactive'}
              data-slot="tabs-trigger"
              data-orientation="horizontal"
              className=${classes.slots['tabs-trigger']}
              onClick=${() => setSelected(item)}
            >
              ${item}
            </button>`,
        )}
      </div>
      ${children}
    </div>`;
  };
};
