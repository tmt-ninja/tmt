# Portable component renderer

This private leaf exposes one versioned component per call; it does not compose trees or resolve a terminal palette. `registry()` returns the closed kebab-case names and version; `render(name, props_json, width, height)` returns a JSON cell grid or throws a JSON error with a stable `code`. The native `render_json` uses the same implementation.

`tests/vectors/v1.json` owns the versioned inputs, expected outputs and measured artifact sizes. Its expected cells use run-length encoding; parity checks expand and compare every cell. Props follow the types in `tmt-tui-components`, with all `u64` fields (including chip IDs) represented by canonical decimal strings. Nullable properties must be present; only `more-hint.direction` has its documented default. Unknown fields and names are rejected. Role strings are the `tmt-cli-style` role names; `chip_surface` is `idle`, `hot`, `disabled`, or null. Cells are row-major, including wide-glyph continuation cells, and hit rectangles carry decimal-string IDs.

The renderer admits at most 65,536 UTF-8 input bytes, nesting depth 32, 4,096 bytes per string, 64 bytes per grapheme, 256 chips and 4,096 points. Dimensions are 1–512 columns, 1–256 rows and at most 32,768 cells. It checks JavaScript string size and UTF-16 validity before copying into wasm memory, rejects invalid input before allocating the grid and limits output to 16 MiB.

Gzip sizes in the vector are pinned to the hosted Linux CI runner; local macOS zlib builds can differ by a few bytes. The Node parity runner compares the checked-in vector with both native output and actual wasm-bindgen output. Its generated wasm and glue sizes are recorded independently; their combined gzip budget is capped at 524,288 bytes. Browser asset delivery, CSP and offline export remain the caller's responsibility.

| Name | Props |
| --- | --- |
| `section-rule` | `title`, `note`, `note_role`, `focused` |
| `pane-rule` | `title`, `note`, `note_role`, `focused`, `ascii` |
| `pane-frame` | `title`, `focused`, `ascii`, `back_hint` |
| `chip-row` | `label`, `chips` (`id`, `label`, `gap`, `enabled`), `selected`, `cursor`, `active` |
| `gauge` | `label`, `label_width`, `numerator`, `denominator`, `total`, `filled_role`, `rest_role` |
| `sparkline` | `points`, `scale`, `unavailable` |
| `stacked-bars` | `points` (`used`, `saved`), `used_role`, `saved_role`, `missing_role` |
| `mark` | `state`, `label`, `emphasis` |
| `more-hint` | `count`, optional `direction`, `ascii` |

Mark states are `working`, `waiting`, `blocked`, `review`, `idle`, `offline`, `ended`, and `shell`. More-hint directions are `down`, `up`, `right`, and `truncated`. Chip selection and cursor are zero-based indices or null; points and per-point values may be null where their component allows missing observations.
