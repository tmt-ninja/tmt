import { framesFor, oracle, type Frame } from './model.js';

export { tuiRoot } from '../routes.js';
export const tuiGroups = ['Getting started', 'Foundations', 'Components', 'Patterns'] as const;
export type TuiGroup = (typeof tuiGroups)[number];
export const stateKinds = ['normal', 'focused', 'disabled', 'empty', 'error', 'narrow'] as const;
export type StateKind = (typeof stateKinds)[number];
export const stateLabels: Record<StateKind, string> = {
  normal: 'Normal',
  focused: 'Focused or selected',
  disabled: 'Disabled',
  empty: 'Empty',
  error: 'Error',
  narrow: 'Narrow width',
};
export interface Sample {
  state: string;
  width?: number;
  height?: number;
  crop?: [number, number];
  look?: string;
}
export interface NamedSample {
  label: string;
  sample: Sample;
}
export interface AnatomyPart {
  name: string;
  row: number;
  text: string;
}
export interface ComponentDoc {
  slug: string;
  title: string;
  lead: string;
  section: string;
  source: string[];
  evidenceNote?: string;
  anatomy: Sample;
  parts: AnatomyPart[];
  states: (NamedSample & { kind: StateKind })[];
  keys: string[];
  roles: (keyof typeof oracle.roles)[];
}
const sample = (state: string, crop?: [number, number], width?: number): Sample => ({
  state,
  crop,
  width,
});
const narrow = (state: string, crop?: [number, number]): Sample => ({
  state,
  crop,
  width: 60,
  height: 36,
});

/** Coordinates come from exact text in a particular source row, never a replacement drawing. */
export function resolveSample(
  input: Sample,
  look: string,
): { frame: Frame; from: number; to: number } {
  const candidates = framesFor(input.state, input.look ?? look).filter(
    (frame) =>
      (input.width === undefined || frame.width === input.width) &&
      (input.height === undefined || frame.height === input.height),
  );
  const frame =
    candidates.find((frame) => frame.width === 100 && frame.height === 36) ?? candidates[0];
  if (!frame) throw new Error(`Missing real oracle frame: ${JSON.stringify(input)} / ${look}`);
  const [from, to] = input.crop ?? [0, frame.height];
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to > frame.height ||
    from >= to
  )
    throw new Error(`Invalid source row range for ${input.state}`);
  return { frame, from, to };
}
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
export function locatePart(frame: Frame, part: AnatomyPart) {
  const line = frame.lines[part.row - 1];
  const index = line?.indexOf(part.text) ?? -1;
  if (index < 0 || line!.indexOf(part.text, index + part.text.length) >= 0)
    throw new Error(
      `Anatomy label is absent or ambiguous: ${frame.state}, row ${part.row}, ${part.text}`,
    );
  const column = [...graphemes.segment(line!.slice(0, index))].length + 1;
  return { row: part.row, column, end: column + [...graphemes.segment(part.text)].length - 1 };
}
export const cliStyle = (section: string) =>
  `https://github.com/tmt-ninja/tmt/blob/main/design/cli-style.md#${section}`;

const recordedExamples: Omit<ComponentDoc, 'source'>[] = [
  {
    slug: 'header',
    title: 'Header / title bar',
    lead: 'Identifies the workspace and exposes its primary actions and observed status.',
    section: 'full-screen-interaction',
    anatomy: sample('agents', [0, 2]),
    parts: [
      { name: 'Identity and context', row: 1, text: 'TMT' },
      { name: 'Primary action', row: 1, text: 'Snapshots' },
      { name: 'Status summary', row: 1, text: 'online' },
    ],
    states: [
      { kind: 'normal', label: 'Workspace title', sample: sample('agents', [0, 2]) },
      {
        kind: 'narrow',
        label: 'Narrow title and retained status',
        sample: narrow('agents', [0, 2]),
      },
    ],
    keys: ['w', 'g'],
    roles: ['text', 'muted', 'dim', 'keycap', 'keycap-selected'],
  },
  {
    slug: 'tabs',
    title: 'Tabs',
    lead: 'Selects the current top-level board view while preserving the inactive choices.',
    section: 'roles-by-component-state',
    anatomy: sample('agents', [0, 2]),
    parts: [
      { name: 'Selected view', row: 2, text: 'Agents' },
      { name: 'Inactive view', row: 2, text: 'Digest' },
    ],
    states: [
      {
        kind: 'focused',
        label: 'Selected Agents and inactive Digest',
        sample: sample('agents', [1, 2]),
      },
      { kind: 'narrow', label: 'Narrow view tabs', sample: narrow('agents', [0, 2]) },
    ],
    keys: ['1', '2'],
    roles: ['text', 'muted', 'dim', 'selection', 'keycap'],
  },
  {
    slug: 'list',
    title: 'List and selection row',
    lead: 'Presents agent or squad rows with one visible selection and a stable gutter.',
    section: 'lists-and-selection',
    anatomy: sample('agents', [7, 15]),
    parts: [
      { name: 'Scope choices', row: 8, text: 'Squads' },
      { name: 'Column labels', row: 9, text: 'SQUAD / AGENT' },
      { name: 'Group', row: 11, text: 'product' },
      { name: 'Selected row', row: 12, text: 'worker' },
    ],
    states: [
      {
        kind: 'normal',
        label: 'Retained row while the composer owns focus',
        sample: sample('composer-empty', [7, 15]),
      },
      { kind: 'focused', label: 'Selected agent row', sample: sample('agents', [7, 15]) },
      { kind: 'empty', label: 'No matching rows', sample: sample('search-agents-all-empty') },
      { kind: 'error', label: 'Retained stale row and notice', sample: sample('stale') },
      { kind: 'narrow', label: 'Narrow list', sample: narrow('agents', [7, 15]) },
    ],
    keys: ['↑↓', 'Home', 'End', 'Enter', '/', 'f'],
    roles: ['text', 'muted', 'dim', 'selection', 'working', 'waiting', 'blocked'],
  },
  {
    slug: 'table',
    title: 'Table and columns',
    lead: 'Aligns observed values into named columns and exposes the recorded sort order.',
    section: 'lists',
    anatomy: sample('agents-sorted', [8, 15]),
    parts: [
      { name: 'Identity column', row: 9, text: 'AGENT' },
      { name: 'Scope column', row: 9, text: 'SQUAD' },
      { name: 'State column', row: 9, text: 'STATE' },
      { name: 'Sorted metric', row: 9, text: 'TOK 1h' },
    ],
    states: [
      { kind: 'normal', label: 'Metric sort', sample: sample('agents-sorted', [8, 15]) },
      {
        kind: 'focused',
        label: 'State sort and selected row',
        sample: sample('agents-state-sorted', [7, 15]),
      },
      { kind: 'empty', label: 'Filtered empty table', sample: sample('search-agents-all-empty') },
      { kind: 'narrow', label: 'Narrow columns', sample: narrow('agents-sorted', [7, 15]) },
    ],
    keys: ['↑↓', 'Home', 'End'],
    roles: ['text', 'muted', 'dim', 'selection'],
  },
  {
    slug: 'chips',
    title: 'Chips and status marks',
    lead: 'Shows compact scope choices, measurement settings and marked member status.',
    section: 'themes',
    anatomy: sample('header-usage', [3, 8]),
    parts: [
      { name: 'Range chip', row: 4, text: 'Range 1h' },
      { name: 'Interval chip', row: 4, text: '5m per bar (auto)' },
      { name: 'Provider mark and value', row: 7, text: 'Codex' },
    ],
    states: [
      { kind: 'normal', label: 'Measurement chips', sample: sample('header-usage', [3, 8]) },
      {
        kind: 'focused',
        label: 'Selected scope and unread mark',
        sample: sample('unread-working', [7, 15]),
      },
      {
        kind: 'disabled',
        label: 'Disabled short intervals in the recorded menu',
        sample: { state: 'usage-disabled-each', width: 60, height: 51 },
      },
      { kind: 'narrow', label: 'Narrow scope choices', sample: narrow('agents', [7, 15]) },
    ],
    keys: ['f', '↑↓', 'Enter', 'Esc'],
    roles: ['text', 'muted', 'dim', 'track', 'selection', 'accent', 'unread', 'keycap'],
  },
  {
    slug: 'meter',
    title: 'Meter',
    lead: 'Visualises recorded usage and quota without replacing unknown data with a measured zero.',
    section: 'themes',
    anatomy: sample('header-usage', [3, 8]),
    parts: [
      { name: 'Time window', row: 4, text: 'last 1h' },
      { name: 'First provider and track', row: 6, text: 'Claude' },
      { name: 'Second provider and reading', row: 7, text: 'Codex' },
      { name: 'Time axis', row: 8, text: '−60m' },
    ],
    states: [
      {
        kind: 'normal',
        label: 'Recorded provider readings',
        sample: sample('header-usage', [3, 8]),
      },
      { kind: 'empty', label: 'No observations', sample: sample('agents', [3, 6]) },
      { kind: 'narrow', label: 'Narrow usage band', sample: narrow('header-usage', [3, 8]) },
    ],
    keys: [],
    roles: ['text', 'muted', 'dim', 'track', 'accent'],
  },
  {
    slug: 'key-hints',
    title: 'Key hints and footer',
    lead: 'Shows the effective actions for the recorded input and focused pane.',
    section: 'footer-and-key-help',
    anatomy: sample('agents', [34, 36]),
    parts: [
      { name: 'Recipient and unread context', row: 35, text: 'worker' },
      { name: 'Input action', row: 35, text: 'send' },
      { name: 'Pane navigation', row: 36, text: '↑↓←→ move' },
    ],
    states: [
      {
        kind: 'normal',
        label: 'Row navigation and input hints',
        sample: sample('agents', [34, 36]),
      },
      { kind: 'focused', label: 'Composer focus hints', sample: sample('composer-2', [30, 36]) },
      { kind: 'narrow', label: 'Narrow hints', sample: narrow('agents', [34, 36]) },
    ],
    keys: ['?'],
    roles: ['text', 'muted', 'dim', 'keycap', 'keycap-selected'],
  },
  {
    slug: 'dialog',
    title: 'Dialog',
    lead: 'Presents a bounded confirmation or result above the board before an operation proceeds.',
    section: 'dialogs',
    anatomy: sample('review', [13, 24]),
    parts: [
      { name: 'Title', row: 14, text: 'Leave squad' },
      { name: 'Operation summary', row: 15, text: 'Remove membership' },
      { name: 'Actions', row: 23, text: 'Cancel' },
      { name: 'Effective dialog keys', row: 23, text: 'Esc cancel' },
    ],
    states: [
      { kind: 'normal', label: 'Membership confirmation', sample: sample('review', [13, 24]) },
      { kind: 'error', label: 'Unconfirmed operation result', sample: sample('result') },
      { kind: 'narrow', label: 'Narrow confirmation', sample: narrow('review') },
    ],
    keys: ['←→', 'Enter', 'Esc'],
    roles: ['text', 'muted', 'dim', 'selection', 'waiting', 'blocked'],
  },
  {
    slug: 'overlay',
    title: 'Overlay / menu',
    lead: 'Places a focused menu or reference layer above the current workspace.',
    section: 'overlays',
    anatomy: sample('settings-menu', [12, 35]),
    parts: [
      { name: 'Section title', row: 13, text: 'settings' },
      { name: 'Selected choice', row: 15, text: 'Auto layout (current)' },
      { name: 'Scroll position', row: 33, text: '1–17 of 17' },
      { name: 'Layer keys', row: 34, text: 'Esc close' },
    ],
    states: [
      {
        kind: 'focused',
        label: 'Selected settings choice',
        sample: sample('settings-menu', [12, 35]),
      },
      {
        kind: 'disabled',
        label: 'Unavailable interval choices',
        sample: { state: 'usage-disabled-each', width: 60, height: 51 },
      },
      { kind: 'narrow', label: 'Narrow settings layer', sample: narrow('settings-menu') },
    ],
    keys: ['↑↓', 'Enter', 'Esc'],
    roles: ['text', 'muted', 'dim', 'selection', 'accent'],
  },
  {
    slug: 'text-input',
    title: 'Text input',
    lead: 'Collects a recipient-bound message draft before the user submits it.',
    section: 'dialogs',
    anatomy: sample('composer-2', [30, 35]),
    parts: [
      { name: 'Draft value', row: 32, text: 'draft line 1' },
      { name: 'Next draft line', row: 33, text: 'draft line 2' },
      { name: 'Recipient context', row: 35, text: 'worker' },
      { name: 'Submission hint', row: 35, text: 'send' },
    ],
    states: [
      {
        kind: 'empty',
        label: 'Empty focused composer',
        sample: sample('composer-empty', [30, 35]),
      },
      { kind: 'focused', label: 'Focused two-line draft', sample: sample('composer-2', [30, 35]) },
      {
        kind: 'normal',
        label: 'Long draft retains its real scroll state',
        sample: sample('composer-8'),
      },
      { kind: 'narrow', label: 'Narrow composer', sample: narrow('composer-2') },
    ],
    keys: ['Enter', 'Alt+Enter', '@'],
    roles: ['text', 'muted', 'dim', 'track', 'accent'],
  },
  {
    slug: 'messages',
    title: 'Messages / toast',
    lead: 'Reports a host result or failure in the recorded notice area.',
    section: 'empty-loading-and-error-states',
    anatomy: sample('stale', [34, 36]),
    parts: [
      { name: 'Retained recipient context', row: 35, text: 'worker' },
      { name: 'Failure notice', row: 36, text: 'Roster read failed; retained data is stale' },
    ],
    states: [
      { kind: 'normal', label: 'No active notice', sample: sample('agents', [34, 36]) },
      { kind: 'error', label: 'Stale-read notice', sample: sample('stale', [34, 36]) },
      { kind: 'narrow', label: 'Narrow notice', sample: narrow('stale', [34, 36]) },
    ],
    keys: [],
    roles: ['text', 'muted', 'dim', 'blocked'],
  },
  {
    slug: 'help',
    title: 'Help screen',
    lead: 'Lists the effective bindings and keeps reference navigation inside its layer.',
    section: 'footer-and-key-help',
    anatomy: sample('help', [3, 35]),
    parts: [
      { name: 'Layer title', row: 4, text: 'help' },
      { name: 'Bindings heading', row: 5, text: 'effective scoped bindings' },
      { name: 'Effective key', row: 16, text: 'ctrl-r' },
      { name: 'Scroll position', row: 33, text: '1–28 of 175' },
      { name: 'Reference navigation', row: 34, text: 'PgUp/PgDn' },
    ],
    states: [
      { kind: 'normal', label: 'Effective bindings', sample: sample('help') },
      { kind: 'narrow', label: 'Narrow help', sample: narrow('help') },
    ],
    keys: ['↑↓', 'PgUp/PgDn', 'Esc', '?'],
    roles: ['text', 'muted', 'dim', 'accent'],
  },
  {
    slug: 'states',
    title: 'Empty, loading and error states',
    lead: 'Distinguishes absent content, a read in progress and retained failed-read data.',
    section: 'empty-loading-and-error-states',
    anatomy: sample('conversation-loading', [20, 27]),
    parts: [
      { name: 'Content heading', row: 21, text: 'Conversation' },
      { name: 'Loading content', row: 26, text: 'Loading conversation' },
    ],
    states: [
      {
        kind: 'normal',
        label: 'Recorded loading conversation',
        sample: sample('conversation-loading', [20, 27]),
      },
      { kind: 'empty', label: 'Empty workspace', sample: sample('empty') },
      { kind: 'error', label: 'Retained stale data', sample: sample('stale') },
      { kind: 'narrow', label: 'Narrow loading content', sample: narrow('conversation-loading') },
    ],
    keys: [],
    roles: ['text', 'muted', 'dim', 'waiting', 'blocked'],
  },
];

// A component page may reuse a source crop, but owns its anatomy, purpose and evidence limits.
function component(
  base: string,
  doc: Partial<ComponentDoc> & Pick<ComponentDoc, 'slug' | 'title' | 'source'>,
): ComponentDoc {
  const example = recordedExamples.find((entry) => entry.slug === base);
  if (!example) throw new Error(`Unknown recorded example: ${base}`);
  return { ...example, ...doc };
}
const widget = (name: string) => `rust/crates/tmt-tui/src/components/${name}.rs`;
const board = (name: string) => `extensions/tmt-ops/rust/tmt-ops/src/board/${name}.rs`;
export const componentDocs: ComponentDoc[] = [
  component('header', {
    slug: 'header',
    title: 'Title bar and context',
    source: [board('view/header')],
    evidenceNote: 'OPS / UI is a context label, not a separately navigable breadcrumb widget.',
  }),
  component('tabs', {
    slug: 'tabs',
    title: 'Tab bar',
    source: [board('view/tabs'), board('workspace/render')],
  }),
  component('dialog', {
    slug: 'button',
    title: 'Button and button row',
    lead: 'Offers explicit actions within a dialog without changing their reserved cell positions.',
    source: [widget('button'), widget('strip')],
    anatomy: sample('review', [22, 24]),
    parts: [
      { name: 'Cancel action', row: 23, text: 'Cancel' },
      { name: 'Confirm action', row: 23, text: 'Leave squad' },
    ],
    states: [
      {
        kind: 'normal',
        label: 'Recorded confirmation actions',
        sample: sample('review', [22, 24]),
      },
    ],
    roles: ['text', 'keycap', 'keycap-selected', 'dim'],
  }),
  component('list', {
    slug: 'list',
    title: 'List row',
    source: [widget('list'), board('workspace/render')],
  }),
  component('list', {
    slug: 'selection',
    title: 'Selection cursor',
    lead: 'Identifies the input-owning pane and selected row while retaining context when focus moves.',
    source: [widget('list'), board('workspace/render')],
    anatomy: sample('agents', [7, 12]),
    parts: [
      { name: 'Focused pane cursor', row: 8, text: '▸' },
      { name: 'Selected member', row: 12, text: 'worker' },
    ],
    states: [
      { kind: 'focused', label: 'Rows own focus', sample: sample('agents', [7, 12]) },
      {
        kind: 'normal',
        label: 'Retained row while input owns focus',
        sample: sample('composer-empty', [7, 12]),
      },
    ],
  }),
  component('table', {
    slug: 'table-header',
    title: 'Table header',
    source: [widget('collection'), board('header_sort')],
    anatomy: sample('agents-sorted', [8, 10]),
  }),
  component('table', {
    slug: 'table-columns',
    title: 'Table columns',
    source: [widget('collection'), board('workspace/render')],
  }),
  component('overlay', {
    slug: 'scroll-indicator',
    title: 'Scroll position indicator',
    lead: 'Reports the recorded visible row range and remaining content.',
    source: [widget('scroll'), board('workspace/render')],
    anatomy: sample('dense', [14, 15]),
    parts: [
      { name: 'Visible range', row: 15, text: '149–153 / 153 rows' },
      { name: 'Remaining rows', row: 15, text: '0 more ↓' },
    ],
    states: [
      { kind: 'normal', label: 'End of a long list', sample: sample('dense', [7, 15]) },
      { kind: 'focused', label: 'Menu range', sample: sample('settings-menu', [32, 35]) },
    ],
    keys: ['↑↓', 'PgUp/PgDn', 'Home/End'],
  }),
  component('list', {
    slug: 'pane-border',
    title: 'Pane border',
    lead: 'Frames the pane title and shows which pane owns input.',
    source: [widget('outline'), board('pane_chrome')],
    anatomy: sample('agents', [7, 9]),
    parts: [
      { name: 'Focused rule', row: 8, text: '▸' },
      { name: 'Pane controls', row: 8, text: 'Squads' },
    ],
    states: [
      { kind: 'focused', label: 'List pane owns focus', sample: sample('agents', [7, 9]) },
      { kind: 'normal', label: 'Detail pane owns focus', sample: sample('terminal-live', [7, 22]) },
    ],
    keys: [],
  }),
  component('list', {
    slug: 'pane-split',
    title: 'Pane split',
    lead: 'Divides the recorded list and detail composition using the host layout.',
    source: [board('workspace/render'), board('pane_chrome')],
    anatomy: sample('agents', [14, 21]),
    parts: [
      { name: 'List totals', row: 15, text: '1–3 / 3 rows' },
      { name: 'Detail pane title', row: 16, text: 'Talk' },
      { name: 'Conversation region', row: 21, text: 'Conversation' },
    ],
    states: [
      { kind: 'normal', label: 'Recorded workspace split', sample: sample('agents') },
      { kind: 'narrow', label: 'Narrow workspace composition', sample: narrow('agents') },
    ],
    keys: [],
  }),
  component('chips', {
    slug: 'status-mark',
    title: 'Status mark',
    lead: 'Pairs a semantic mark with observed member status instead of relying on colour alone.',
    section: 'marks',
    source: ['rust/crates/tmt-cli-style/src/mark.rs', board('workspace/render')],
    anatomy: sample('agents', [10, 12]),
    parts: [{ name: 'Status and text', row: 12, text: '● working' }],
    states: [
      { kind: 'normal', label: 'Working', sample: sample('agents', [10, 12]) },
      { kind: 'focused', label: 'Unread activity', sample: sample('unread-working', [10, 12]) },
    ],
    keys: [],
  }),
  component('chips', {
    slug: 'count-chip',
    title: 'Count chip',
    lead: 'Shows the recorded unread count beside its status mark.',
    source: [widget('strip'), board('row_chips')],
    anatomy: sample('unread-working', [10, 12]),
    parts: [{ name: 'Unread count', row: 12, text: '50+ unread' }],
    states: [
      { kind: 'normal', label: 'Unread count', sample: sample('unread-working', [10, 12]) },
      { kind: 'empty', label: 'Cleared unread count', sample: sample('unread-cleared') },
    ],
    keys: [],
    roles: ['unread', 'text', 'dim'],
  }),
  component('chips', {
    slug: 'state-chip',
    title: 'State chip',
    lead: 'Keeps the member state readable alongside optional source-supplied chips.',
    source: [widget('strip'), board('row_chips')],
    anatomy: sample('agents', [10, 12]),
    parts: [{ name: 'Observed state', row: 12, text: 'working' }],
    states: [
      { kind: 'normal', label: 'Working member', sample: sample('agents', [10, 12]) },
      { kind: 'focused', label: 'Unread idle member', sample: sample('unread-idle', [10, 12]) },
    ],
    keys: [],
  }),
  component('meter', {
    slug: 'meter',
    title: 'Progress and usage meter',
    source: [board('view/header'), board('meter')],
    evidenceNote:
      'This records usage and quota paint. It does not claim a generic task-progress widget.',
  }),
  component('states', {
    slug: 'spinner',
    title: 'Spinner and status slot',
    lead: 'Reserves a caller-owned status line with an optional busy marker.',
    section: 'motion',
    source: [widget('status'), board('view/header')],
    evidenceNote:
      'Missing frame: no dedicated busy-marker recording is included. The frame below is loading context only; it is not spinner evidence.',
    states: [
      {
        kind: 'normal',
        label: 'Loading context only — busy glyph not recorded',
        sample: sample('conversation-loading', [20, 27]),
      },
    ],
    keys: [],
  }),
  component('key-hints', {
    slug: 'key-hints',
    title: 'Key hint',
    source: [widget('key_help'), board('view/footer')],
  }),
  component('key-hints', {
    slug: 'footer',
    title: 'Footer',
    lead: 'Fits the effective pane actions into the reserved final terminal row.',
    source: [widget('key_help'), board('view/footer')],
    anatomy: sample('agents', [35, 36]),
    parts: [
      { name: 'Pane navigation keys', row: 36, text: '↑↓←→ move' },
      { name: 'Help entry', row: 36, text: '? help' },
    ],
  }),
  component('dialog', {
    slug: 'dialog',
    title: 'Dialog',
    source: [widget('dialog'), widget('modal'), board('workspace/render')],
  }),
  component('dialog', {
    slug: 'confirm-dialog',
    title: 'Confirm dialog',
    lead: 'Shows the operation and its consequences before a membership change is confirmed.',
    source: [widget('dialog'), board('workspace/render')],
  }),
  component('overlay', {
    slug: 'overlay',
    title: 'Menu and overlay',
    source: [widget('modal'), widget('picker'), board('view/overlays')],
  }),
  component('text-input', {
    slug: 'text-input',
    title: 'Text input and composer',
    source: [widget('editor'), board('input_field')],
  }),
  component('text-input', {
    slug: 'search',
    title: 'Search and filter field',
    lead: 'Edits a query and reports the matching rows without replacing the underlying list.',
    source: [widget('editor'), widget('picker'), board('search_field')],
    anatomy: sample('search-agents-all-matches', [7, 10]),
    parts: [
      { name: 'Query', row: 8, text: 'agent-00007' },
      { name: 'Match count', row: 8, text: '1 of 28' },
      { name: 'Clear action', row: 8, text: '×' },
    ],
    states: [
      {
        kind: 'focused',
        label: 'Matching query',
        sample: sample('search-agents-all-matches', [7, 10]),
      },
      { kind: 'empty', label: 'No matching rows', sample: sample('search-agents-all-empty') },
    ],
    keys: ['/', 'Esc'],
  }),
  component('overlay', {
    slug: 'completion',
    title: 'Completion picker',
    lead: 'Offers source-range candidates while the application keeps routing and submission authority.',
    source: [widget('completion'), board('composer')],
    anatomy: sample('mention-picker', [27, 35]),
    parts: [
      { name: 'Selected candidate', row: 29, text: 'tmt/night-2' },
      { name: 'Insertion hint', row: 31, text: 'Tab insert' },
      { name: 'Query', row: 33, text: 'tmt/ni' },
    ],
    states: [
      { kind: 'focused', label: 'Mention candidates', sample: sample('mention-picker', [27, 35]) },
    ],
    keys: ['↑↓', 'Tab', 'Esc'],
  }),
  component('states', {
    slug: 'terminal',
    title: 'Terminal surface',
    lead: 'Displays the real terminal capture without drawing a replacement terminal.',
    source: [widget('terminal'), board('terminal_tab/paint')],
    anatomy: sample('terminal-live', [20, 28]),
    parts: [
      { name: 'Terminal title and dimensions', row: 22, text: 'Terminal 48×8' },
      { name: 'Captured prompt', row: 23, text: '$ cargo test' },
      { name: 'Captured output', row: 27, text: 'test a ... ok' },
    ],
    states: [
      {
        kind: 'normal',
        label: 'Live captured terminal',
        sample: sample('terminal-live', [20, 28]),
      },
      { kind: 'empty', label: 'Connecting', sample: sample('terminal-connecting', [20, 26]) },
    ],
    keys: ['Enter', 'Esc', 'z'],
  }),
  component('messages', {
    slug: 'messages',
    title: 'Message and notice',
    source: [board('notice')],
    evidenceNote: 'This is the recorded persistent notice area, not an invented transient toast.',
  }),
  component('help', {
    slug: 'help',
    title: 'Help overlay',
    source: [widget('key_help'), board('help')],
  }),
  component('states', {
    slug: 'empty',
    title: 'Empty state',
    lead: 'Explains the absence of a current recipient or query result.',
    source: [board('workspace/render')],
    anatomy: sample('empty', [15, 21]),
    parts: [
      { name: 'Selected scope', row: 17, text: 'Common pool' },
      { name: 'Empty explanation', row: 20, text: 'No current recipient observed.' },
    ],
    states: [
      { kind: 'empty', label: 'No recipient', sample: sample('empty', [15, 21]) },
      { kind: 'normal', label: 'No query matches', sample: sample('search-agents-all-empty') },
    ],
  }),
  component('states', {
    slug: 'loading',
    title: 'Loading state',
    source: [board('workspace/render')],
    states: [
      {
        kind: 'normal',
        label: 'Conversation read in progress',
        sample: sample('conversation-loading', [20, 27]),
      },
    ],
  }),
  component('messages', {
    slug: 'error',
    title: 'Error and stale state',
    lead: 'Explains failed observations while retaining the last known content.',
    source: [board('notice'), board('workspace/render')],
  }),
];
