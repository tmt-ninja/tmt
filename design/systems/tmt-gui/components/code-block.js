// Ports browser-ui's CodeBlock (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part composed as `ui.compose` says; the part's classes are
// plain names from src/blocks/blocks.css, so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  return function CodeBlock({ language = 'text', filename, variant = 'block', copied, children }) {
    if (variant === 'command')
      return html`<div className="tmt-ui-command"><pre className="tmt-ui-command-text"><code>${children}</code></pre></div>`;
    return html`<div data-slot="code-block" className="tmt-block-code">
      <div className="tmt-block-code-head">
        <span className="tmt-block-code-file">${filename ?? language}</span>
        ${filename !== undefined && html`<span>${language}</span>`}
        <button type="button" className="tmt-block-code-copy" aria-label=${copied ? 'Copied' : 'Copy code'}>${copied ? html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>` : html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>`}<span aria-live="polite">${copied ? 'Copied' : ''}</span></button>
      </div>
      <pre className="tmt-block-code-body"><code>${children}</code></pre>
    </div>`;
  };
};
