# TUI docs and Agents mock

This is the docs-only #5835 slice of foundation #5827. It adds no product runtime,
Colab admission, terminal connection or input authority. `tmt-tui-frame` displays
real painter cells; it never draws a replacement terminal interface.

- `../tui-nav.tsx` supplies navigation metadata and loads `index.tsx` or
  `../mock-tui/index.tsx` when their TUI routes are opened. The metadata keeps
  the recorded frame model out of the eager docs shell.
- `generate.mjs` reads the Ops HOME oracle, the CLI theme and the design tokens
  (`sources`). It expands the oracle dictionaries without modifying source cells
  and interns only the listed scenes; a listed scene the oracle no longer records
  throws, naming it. There is no checked-in copy: `oracle-module.mjs` is the Vite
  plugin that runs `extract()` at build time in place of `oracle-source.ts`, and
  Node runs that module as written. CI's `browser_ui` selection includes every
  file in `sources`, so an Ops change that drops a scene fails its own audits.
- `model.ts` decodes those dictionaries and interprets the painter's style table.
  `Reset` uses an explicit preview terminal default. ANSI16 uses the real theme's
  representative `ANSI_RGB` values; an actual terminal can configure its palette.
  GUI palette B never recolours the cells. Dim is a foreground blend rather than
  opacity on the cell background. Blink is shown as a static captured frame.
- Terminal geometry stays in cells. The frame scrolls on a narrow viewport;
  its text does not reflow with the website. Crops preserve whole source rows.

From `design/browser-ui`:

```sh
../../typescript/node_modules/.bin/vp test run --config vitest.config.ts test/tui-frame.test.ts
./node_modules/.bin/playwright test --config docs/tui/playwright.config.ts
```

Do not run the Rust recorder or modify TUI paths. The unit test checks the
listed scenes and exact source cells/styles. The browser suite
uses a private port and the real wired docs routes, with one headless worker and
no retries. Apply the team host-health gate before running it. Captures go to
`TUI_DOCS_CAPTURE_DIR`; traces/results go to `TUI_DOCS_TEST_RESULTS`.
