// The page runtime adds the shared portal to a DOM-owned DsScope stage. The stage hugs its
// content; `height` is a minimum. A phone sheet sizes itself from the stage (60cqh), so a stage
// holding one and no minimum takes the sheet's own height instead and never follows it.
const sheetShare = 0.6;
const stageHeight = (min, node) => {
  const sheet = node.querySelector('.tmt-block-menu[data-placement="sheet"]');
  if (sheet) return min || Math.ceil((sheet.scrollHeight + sheet.offsetHeight - sheet.clientHeight) / sheetShare);
  return Math.max(min, node.offsetHeight);
};
export default ({ React, html, pagePin }) =>
  function MockupBlock(props) {
    const [width, setWidth] = React.useState(
      props.preset === '1440'
        ? 1440
        : props.preset === 'custom'
          ? Math.max(1, Math.min(4096, Number(props.width) || 390))
          : 390,
    );
    const [custom, setCustom] = React.useState(props.preset === 'custom');
    const [theme, setTheme] = React.useState('viewer');
    const viewport = React.useRef(null);
    const [available, setAvailable] = React.useState(0);
    const content = React.useRef(null);
    const min = Math.max(0, Math.min(2000, Number(props.height) || 0));
    const [height, setHeight] = React.useState(min);
    const requestedSystem = props.system || pagePin.system;
    const requestedLock = props.lock || pagePin.lock;
    const matchesLock =
      requestedLock === pagePin.lock ||
      (pagePin.lock !== 'follow' && requestedLock === pagePin.version);
    const unavailable = requestedSystem !== pagePin.system || !matchesLock;
    React.useLayoutEffect(() => {
      const node = viewport.current;
      if (!node) return;
      const measure = () => setAvailable(node.clientWidth);
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, []);
    const scale = width > 390 && available ? Math.min(1, available / width) : 1;
    React.useLayoutEffect(() => {
      const node = content.current;
      if (!node) return;
      const measure = () => setHeight(Math.min(4096, stageHeight(min, node)));
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }, [min, width, unavailable]);
    const segment = (key, pressed, onClick, label) => html`<button
      key=${key}
      type="button"
      aria-pressed=${pressed}
      onClick=${onClick}
    >
      ${label}
    </button>`;
    return html`<section className="tmt-block-mockup" aria-label="Mockup stage">
      <div className="tmt-block-mockup-toolbar" role="toolbar" aria-label="Mockup settings">
        <span className="tmt-block-mockup-pin">${requestedSystem}@${requestedLock}</span>
        <div className="tmt-block-mockup-segments" role="group" aria-label="Stage width">
          ${[390, 1440].map((size) =>
            segment(size, !custom && width === size, () => {
              setCustom(false);
              setWidth(size);
            }, size),
          )}
          ${segment('custom', custom, () => setCustom(true), 'Custom')}
        </div>
        ${
          custom &&
          html`<input
            type="number"
            aria-label="Stage width"
            min="1"
            max="4096"
            value=${width}
            onInput=${(event) => setWidth(Math.max(1, Math.min(4096, Number(event.target.value) || 1)))}
          />`
        }
        <div className="tmt-block-mockup-segments" role="group" aria-label="Theme">
          ${[
            ['light', 'Light'],
            ['dark', 'Dark'],
            ['viewer', 'Viewer'],
          ].map(([mode, label]) => segment(mode, theme === mode, () => setTheme(mode), label))}
        </div>
      </div>
      ${scale < 1 && html`<span className="tmt-block-mockup-scale">Scaled ${Math.round(scale * 100)}%</span>`}
      ${unavailable ? html`<p role="status">This page uses ${pagePin.system}@${pagePin.version}${pagePin.lock === 'follow' ? ' (following draft)' : ''}. The requested mockup system or version is unavailable.</p>` : html`<div
        className="tmt-block-mockup-viewport"
        ref=${viewport}
        style=${{ height: height * scale }}
      >
        <div
          data-tmt-ds-scope=""
          className="tmt-block-mockup-stage"
          style=${{ width, height, transform: `scale(${scale})` }}
        >
          <div ref=${content} data-theme=${theme === 'viewer' ? undefined : theme}>${props.children}</div>
        </div>
      </div>`}
    </section>`;
  };
