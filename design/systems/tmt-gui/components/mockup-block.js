// The page runtime adds the shared portal to a DOM-owned DsScope stage.
export default ({ React, html }) =>
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
        ${[390, 1440].map(
          (size) => html`<button
            key=${size}
            type="button"
            aria-pressed=${!custom && width === size}
            onClick=${() => {
              setCustom(false);
              setWidth(size);
            }}
          >
            ${size}
          </button>`,
        )}
        <button type="button" aria-pressed=${custom} onClick=${() => setCustom(true)}>
          Custom
        </button>
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
        ${['light', 'dark', 'viewer'].map(
          (mode) => html`<button
            key=${mode}
            type="button"
            aria-pressed=${theme === mode}
            onClick=${() => setTheme(mode)}
          >
            ${mode}
          </button>`,
        )}
      </div>
      ${scale < 1 && html`<span className="tmt-block-mockup-scale">Scaled ${Math.round(scale * 100)}%</span>`}
      <div
        className="tmt-block-mockup-viewport"
        ref=${viewport}
        style=${{ height: height * scale }}
      >
        <div
          data-tmt-ds-scope=""
          className="tmt-block-mockup-stage"
          style=${{ width, height, transform: `scale(${scale})` }}
        >
          <div data-theme=${theme === 'viewer' ? undefined : theme}>${props.children}</div>
        </div>
      </div>
    </section>`;
  };
