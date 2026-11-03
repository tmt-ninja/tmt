/**
 * The docs' "TUI components" section and the /mock/tui route (#5835). gui-3 owns the pages in
 * docs/tui/ and the mock in docs/mock-tui/; this file is the seam the docs app imports from.
 */
export { tuiPages } from './tui/index.js';
export { TuiMock } from './mock-tui/index.js';
