// The page runtime adds the shared portal to a DOM-owned DsScope stage.
export default ({ React, html }) => function MockupBlock(props) {
  const [width, setWidth] = React.useState(props.preset === '1440' ? 1440 : 390);
  const [theme, setTheme] = React.useState('viewer');
  const viewport = React.useRef(null);
  const [available, setAvailable] = React.useState(0);
  const height = Math.max(100, Math.min(2000, Number(props.height) || 400));
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
  return html`<section className="tmt-block-mockup" aria-label="Mockup stage">
    <div className="tmt-block-mockup-toolbar">
      <span>${props.system || 'tmt-gui'}@${props.lock || 'follow'}</span>
      ${[390, 1440].map((size) => html`<button key=${size} type="button" aria-pressed=${width === size}
        onClick=${() => setWidth(size)}>${size}</button>`)}
      ${['light', 'dark', 'viewer'].map((mode) => html`<button key=${mode} type="button"
        aria-pressed=${theme === mode} onClick=${() => setTheme(mode)}>${mode}</button>`)}
    </div>
    <div className="tmt-block-mockup-viewport" ref=${viewport} style=${{ height: height * scale }}>
      <div data-tmt-ds-scope="" className="tmt-block-mockup-stage"
        style=${{ width, height, transform: `scale(${scale})` }}>
        <div data-theme=${theme === 'viewer' ? undefined : theme}>${props.children}</div>
      </div>
    </div>
  </section>`;
};
