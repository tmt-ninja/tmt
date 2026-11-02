# TUI docs and Agents mock

This is the docs-only #5835 slice of foundation #5827. It adds no product runtime,
Colab admission, terminal connection or input authority. `tmt-tui-frame` displays
frozen real painter cells; it never draws a replacement terminal interface.

- `index.tsx` exports `tuiPages` for the owning docs shell.
- `../mock-tui/index.tsx` exports `TuiMock({ path })`.
- gui-2 owns `tui-nav.tsx`, navigation and router wiring. Slice commits merge
  forward into the served foundation branch, without rebasing that branch.
- `generate.mjs` reads the Ops HOME oracle, the CLI theme, cell style definitions
  and the design tokens. It expands the oracle dictionaries without modifying
  source cells, then interns only the chosen fixtures into `data/oracle.json`.
  Token provenance hashes only the consumed top-level `color`, `mark` and
  `surface` groups; unrelated GUI foundation token edits stay independent.
- `model.ts` decodes those dictionaries and interprets the frozen style table.
  `Reset` uses an explicit preview terminal default. ANSI16 uses the real theme's
  representative `ANSI_RGB` values; an actual terminal can configure its palette.
  GUI palette B never recolours the cells. Dim is a foreground blend rather than
  opacity on the cell background. Blink is shown as a static captured frame.
- Terminal geometry stays in cells. The frame scrolls on a narrow viewport;
  its text does not reflow with the website. Crops preserve whole source rows.

From `design/browser-ui`:

```sh
node docs/tui/generate.mjs --check
../../typescript/node_modules/.bin/vp test run --config vitest.config.ts test/tui-frame.test.ts
./node_modules/.bin/playwright test --config docs/tui/playwright.config.ts
```

Regenerate the frozen selection with `node docs/tui/generate.mjs`, then format
it with the owning formatter. Do not run the Rust recorder or modify TUI paths.
The unit test checks provenance and exact source cells/styles. The browser suite
uses a private port and the real wired docs routes, with one headless worker and
no retries. Apply the team host-health gate before running it. Captures go to
`TUI_DOCS_CAPTURE_DIR`; traces/results go to `TUI_DOCS_TEST_RESULTS`.
