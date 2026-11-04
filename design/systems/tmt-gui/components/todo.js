// Ports browser-ui's TodoBlock (#5981): plain JavaScript and htm on the skeleton (React, html, cn).
// The compiler checks every example draws like the browser-ui part composed as `ui.compose` says; the
// part's classes are plain names from src/blocks/blocks.css and the static BrowserCheckbox's class,
// so `classes` is filled but not read.
export default ({ html }) => {
  const classes = /* classes */ null;
  void classes;
  return function TodoBlock({ checked, assignee, due, overdue, children }) {
    return html`<div data-slot="todo" className="tmt-block-todo" data-checked=${checked ? '' : undefined} data-overdue=${overdue ? '' : undefined}>
      <input
        type="checkbox"
        className="tmt-ui-checkbox"
        checked=${Boolean(checked)}
        readOnly
        aria-label=${typeof children === 'string' ? children : undefined}
      />
      <span className="tmt-block-todo-text">${children}</span>
      ${(assignee !== undefined || due !== undefined) &&
      html`<span className="tmt-block-todo-meta">${assignee}${due !== undefined && html`<span className="tmt-block-todo-due">${due}</span>`}</span>`}
    </div>`;
  };
};
