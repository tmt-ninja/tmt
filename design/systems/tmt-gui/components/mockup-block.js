// A thin wrapper over the MockupBlock part, which owns the toolbar, the hugging stage and its
// centring. The tag resolves its preset and the page pin; the page runtime adds the shared portal.
export default ({ React, ui, pagePin }) =>
  function MockupBlockTag(props) {
    const system = props.system || pagePin.system;
    const lock = props.lock || pagePin.lock;
    const matchesLock =
      lock === pagePin.lock || (pagePin.lock !== 'follow' && lock === pagePin.version);
    const unavailable =
      system !== pagePin.system || !matchesLock
        ? `This page uses ${pagePin.system}@${pagePin.version}${pagePin.lock === 'follow' ? ' (following draft)' : ''}. The requested mockup system or version is unavailable.`
        : false;
    const width =
      props.preset === '1440'
        ? 1440
        : props.preset === 'custom'
          ? Math.max(1, Math.min(4096, Number(props.width) || 390))
          : 390;
    // `toolbar-labels` names Custom, Light, Dark and Viewer in the page's language, all four or
    // none: any other count keeps the English words.
    const words = (props['toolbar-labels'] || '').split(',').map((word) => word.trim());
    const labels =
      words.length === 4 && words.every(Boolean)
        ? { custom: words[0], light: words[1], dark: words[2], viewer: words[3] }
        : undefined;
    return React.createElement(
      ui.MockupBlock,
      { system, version: lock, width, height: Number(props.height) || 0, unavailable, labels },
      props.children,
    );
  };
