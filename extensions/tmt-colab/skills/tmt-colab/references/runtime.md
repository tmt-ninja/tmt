# Page runtime

For a page that must react to the reader (filter, sort, toggle, update a table), ask for React
instead of hand-writing DOM scripts. Colab loads React 19, htm and a curated Lucide icon set into the
page before its own script, with no network and no build step. Tailwind needs no marker: every page
has it ([page-style](page-style.md#tailwind-utilities), `tmt colab skill page-style`).

## Ask for React

Put one marker in the page. The first `meta` with this name decides; its tokens are separated by
ASCII whitespace and `react` loads React (`tailwind` is still accepted and adds nothing; other tokens
are ignored):

```html
<meta name="tmt-colab-runtime" content="react" />
```

Without `react`, `tmt` does not exist.

## Script

Everything is on one global, `tmt`. There is no JSX, Babel or import: `html` is htm bound to React,
so components are tagged templates, and `{...}` values are escaped like React text.

```html
<meta name="tmt-colab-runtime" content="react" />
<div id="app"></div>
<script>
  const { React, createRoot, html, icons } = tmt;
  const { useState } = React;
  const stateClass = {
    working: 'text-working',
    waiting: 'text-waiting',
    blocked: 'text-blocked',
  };
  const rows = [
    { name: 'Build', state: 'working' },
    { name: 'Review', state: 'waiting' },
    { name: 'Deploy', state: 'blocked' },
  ];
  function App() {
    const [query, setQuery] = useState('');
    const shown = rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()));
    return html`
      <section class="flex flex-col gap-4 p-4">
        <label class="flex items-center gap-2 border border-edge bg-sheet px-2 py-1">
          <${icons.Search} aria-label="Search" />
          <input
            class="grow bg-transparent text-text outline-none"
            placeholder="Filter"
            value=${query}
            onInput=${(event) => setQuery(event.target.value)}
          />
        </label>
        <ul class="flex flex-col gap-2">
          ${shown.map(
            (row) => html`
              <li key=${row.name} class="flex items-center gap-2 border-b border-rule pb-2">
                <span class=${stateClass[row.state]}>◆</span>
                <span class="grow">${row.name}</span>
                <span class="text-secondary">${row.state}</span>
              </li>
            `
          )}
        </ul>
      </section>
    `;
  }
  createRoot(document.getElementById('app')).render(html`<${App} />`);
</script>
```

Use ordinary React: `useState`, `useEffect`, `useMemo`, keys on lists. Mount into an element you
write; do not replace `body`. Keep the page's data in the script or in attributes: the frame has
no network, forms or storage.

## Look

Tailwind's utility classes and the token theme work as on every page: read
[page-style](page-style.md#tailwind-utilities) (`tmt colab skill page-style`). A React page also gets
Tailwind's reset (preflight), so set list markers, heading sizes and margins with classes.

A page frame is as tall as the page, so `position: fixed` with `inset: 0` covers the whole page,
not the screen. Design-system dialogs and sheets already open where the reader is. For your own
modal, place it in the part on screen with `top: var(--tmt-ui-viewport-top, 0)` and
`height: var(--tmt-ui-viewport-height, 100vh)`. For the same reason, never size content in the
page's flow with `vh` or `dvh`: it grows with the page, and Colab falls back to scrolling inside
the frame.

On a `column` or `full` page Colab sets the width and gaps ([layout](layout.md)); do not set your own
page width, margin or block gap. Do not add a header, product mark or sticky bar.

## Icons

`icons` holds a curated Lucide set; list it with `Object.keys(tmt.icons)` where the page runs, and use a
member as a component: `<${icons.Check} />`. Icons are 16 px, square-capped and `currentColor` by
default, and decorative unless you give `aria-label` or `title`. An icon that is not listed is
`undefined`: if you need one, use a text mark (`◆ ● ✓ ✗`) instead of drawing SVG paths by hand, and ask
for it to be added.

## Never

- No CDN, `<script src>`, `@import`, font or stylesheet links: the frame denies all network access
  and the page would show nothing.
- No `import` or `require`; no `eval` or `new Function`.
- No second copy of React or Tailwind in the page.
- Do not copy the runtime into the page source; the marker is the only thing the page carries.
