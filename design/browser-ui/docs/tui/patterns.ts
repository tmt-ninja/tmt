import { componentDocs, type AnatomyPart, type NamedSample } from './catalog.js';

export interface PatternDoc {
  slug: string;
  title: string;
  lead: string;
  section: string;
  samples: NamedSample[];
  problem: string;
  anatomy: NamedSample & { parts: AnatomyPart[] };
  rules: string[];
  links: { slug: string; title: string }[];
  missing?: string;
}
const patternAnatomy = (slug: string): PatternDoc['anatomy'] => {
  const doc = componentDocs.find((entry) => entry.slug === slug);
  if (!doc) throw new Error(`Missing pattern component: ${slug}`);
  return {
    label: `${doc.title} in the real Ops composition`,
    sample: doc.anatomy,
    parts: doc.parts,
  };
};
export const patternDocs: PatternDoc[] = [
  {
    slug: 'agents-board',
    title: 'Board layout',
    lead: 'Compose a workspace from stable context, independently focused panes and effective key help.',
    section: 'full-screen-interaction',
    problem:
      'A live board must show scope, selection and detail together without making a refresh feel like navigation.',
    anatomy: {
      label: 'Agents workspace: context, collection and footer',
      sample: { state: 'agents' },
      parts: [
        { name: 'Workspace tab', row: 2, text: 'Agents' },
        { name: 'List scope', row: 8, text: 'Squads' },
        { name: 'Selected identity', row: 12, text: 'worker' },
        { name: 'Effective key help', row: 36, text: '? help' },
      ],
    },
    rules: [
      'Keep context and tab choice above the workspace; reserve the final row for the focused layer’s keys or its notice.',
      'Split by responsibility: the collection chooses an identity, and the detail pane explains that same identity. Do not give both panes separate copies of selection state.',
      'Preserve each pane’s cursor and scroll position across focus changes and refreshes; clamp them only when the available range changes.',
      'Treat surface.rs as composition and admission infrastructure, not another visual component. Use the component modules for the parts of the surface.',
    ],
    samples: [
      { label: 'Normal Agents composition', sample: { state: 'agents' } },
      { label: 'Dense collection with a visible range', sample: { state: 'dense' } },
    ],
    links: [
      { slug: 'pane', title: 'Pane' },
      { slug: 'list', title: 'List' },
      { slug: 'table', title: 'Table' },
      { slug: 'key-help', title: 'Key help' },
    ],
  },
  {
    slug: 'layers-focus',
    title: 'Focus and selection across panes',
    lead: 'Keep a selected target stable while input moves between a collection, an editor and an overlay.',
    section: 'layers-and-focus',
    problem:
      'Selection says which object is being inspected; focus says where the next key goes. Conflating them loses context or sends input to the wrong pane.',
    anatomy: patternAnatomy('list'),
    rules: [
      'Give one base pane input focus, while retaining a cursor in each pane. Indicate the focused pane separately from the selected row.',
      'An overlay owns input before the base and consumes unhandled keys, except the global quit rule. Opening another overlay replaces it.',
      'Keep drafts and collection position when changing focus. Close or confirm only through the owning interaction’s documented keys.',
    ],
    samples: [
      { label: 'Collection owns input', sample: { state: 'agents' } },
      {
        label: 'Composer owns input while the row stays selected',
        sample: { state: 'composer-2' },
      },
      { label: 'Help is the top input layer', sample: { state: 'help' } },
    ],
    links: [
      { slug: 'list', title: 'List variants' },
      { slug: 'text-field', title: 'Text field' },
      { slug: 'modal', title: 'Modal' },
    ],
  },
  {
    slug: 'search-filter',
    title: 'Search and filter flow',
    lead: 'Edit a query, narrow its collection and retain an understandable route back to the full list.',
    section: 'lists-and-selection',
    problem:
      'Filtering changes the visible collection while a user is editing text. A zero-result view must distinguish a valid query from a failed data read.',
    anatomy: patternAnatomy('picker'),
    rules: [
      'Let the editor own query text and cursor movement; let the picker own result navigation and outcomes. Application code owns filtering and effects.',
      'Show query, matching count and the clear action together. Keep identity and the collection’s stable columns visible while results change.',
      'Treat no matches as a valid empty result. Keep it separate from unavailable or stale data, and provide the documented clear or exit action.',
    ],
    samples: [
      { label: 'Query with a matching identity', sample: { state: 'search-agents-all-matches' } },
      { label: 'Valid query with no matching rows', sample: { state: 'search-agents-all-empty' } },
    ],
    links: [
      { slug: 'text-field', title: 'Text field' },
      { slug: 'picker', title: 'Picker' },
      { slug: 'list', title: 'List' },
    ],
  },
  {
    slug: 'confirm-action',
    title: 'Confirming a destructive action',
    lead: 'Make the target and consequence explicit before an irreversible application action.',
    section: 'dialogs',
    problem:
      'A committing action must not depend on a remembered row position or an ambiguous Enter key in the workspace underneath.',
    anatomy: patternAnatomy('dialog'),
    rules: [
      'State the operation and target inside the dialog, with the consequence and a clearly named committing action.',
      'Keep Cancel and the committing action in stable cells. Navigation changes the active choice; only the dialog’s confirm outcome asks the application to act.',
      'Keep the underlying board inert while the dialog owns input. Follow the canonical dialog rules for Escape, drafts and global quit.',
    ],
    samples: [
      { label: 'Recorded leave-squad confirmation and actions', sample: { state: 'review' } },
    ],
    missing:
      'The oracle records this confirmation, not a complete before/confirm/cancel lifecycle. No successful deletion or cancel result is invented here.',
    links: [
      { slug: 'dialog', title: 'Dialog and confirmation variants' },
      { slug: 'button', title: 'Button' },
      { slug: 'modal', title: 'Modal placement' },
    ],
  },
  {
    slug: 'status-flow',
    title: 'Communicating status',
    lead: 'Separate activity, unread attention, measured usage and the freshness of the evidence.',
    section: 'roles-by-component-state',
    problem:
      'A busy member can also have unread content or stale observations. One generic coloured badge cannot explain all three.',
    anatomy: patternAnatomy('chip'),
    rules: [
      'Pair the foundation mark with a readable state; count chips carry quantities rather than keyboard focus or success feedback.',
      'Use a status slot for caller-supplied text, age or busy indication, and an Ops meter only when a measured range and unit exist.',
      'Report failed refresh separately from the retained member state. Do not repaint last-known evidence as a successful current observation.',
    ],
    samples: [
      { label: 'Working member with unread attention', sample: { state: 'unread-working' } },
      { label: 'Idle member with unread attention', sample: { state: 'unread-idle' } },
      { label: 'Waiting member', sample: { state: 'unread-waiting' } },
      { label: 'Unread count cleared', sample: { state: 'unread-cleared' } },
    ],
    missing:
      'No dedicated animated spinner sequence is frozen. Loading context is not evidence of the busy glyph’s animation.',
    links: [
      { slug: 'glyphs', title: 'Foundation marks and glyphs' },
      { slug: 'chip', title: 'Chip' },
      { slug: 'status', title: 'Status slot' },
      { slug: 'meter', title: 'Ops meter' },
      { slug: 'notice', title: 'Ops notice' },
    ],
  },
  {
    slug: 'patterns',
    title: 'Empty, loading, error and stale',
    lead: 'Explain unavailable or incomplete content without erasing context or claiming an observation succeeded.',
    section: 'empty-loading-and-error-states',
    problem:
      'No records, a pending read and a failed refresh can all leave a pane sparse, but they require different explanations and next actions.',
    anatomy: patternAnatomy('notice'),
    rules: [
      'Name an empty result in its pane and retain its scope. Distinguish an empty workspace from a search that matches no rows.',
      'Keep the pane and its surrounding context stable during loading. A partial result must remain explicitly partial.',
      'On refresh failure, retain last-known content when available and state that it is stale. Put the failure and available recovery in the notice rather than silently clearing the collection.',
    ],
    samples: [
      { label: 'Empty workspace', sample: { state: 'empty' } },
      { label: 'Conversation loading', sample: { state: 'conversation-loading' } },
      { label: 'Partial observation', sample: { state: 'partial' } },
      { label: 'Failed refresh with retained stale data', sample: { state: 'stale' } },
    ],
    links: [
      { slug: 'notice', title: 'Ops notice variants' },
      { slug: 'status', title: 'Status slot' },
      { slug: 'list', title: 'List' },
    ],
  },
  {
    slug: 'narrow-widths',
    title: 'Narrow width and degradation',
    lead: 'Preserve identity, selection and essential actions as terminal cells and colour capabilities decrease.',
    section: 'narrow-widths',
    problem:
      'A narrow terminal cannot show every metric, and a reduced palette cannot depend on subtle fills to explain focus or state.',
    anatomy: {
      label: 'Recorded 60-column collection',
      sample: { state: 'agents', width: 60, height: 36, crop: [7, 15] },
      parts: [{ name: 'Selected identity', row: 12, text: 'worker' }],
    },
    rules: [
      'Use terminal column steps, not browser pixels, to decide which secondary columns and hints fit. Keep identity and the focused target legible.',
      'Drop low-priority hints whole; do not cut a key/action pair in half. Clamp scroll ranges while keeping the selected identity visible.',
      'Keep marks and text meaningful in terminal and no-colour modes. The fallback changes paint capability, not the meaning of a state.',
    ],
    samples: [
      ...[60, 100, 160].map((width) => ({
        label: `${width} recorded columns`,
        sample: { state: 'agents', width, height: 36 },
      })),
      { label: 'Terminal palette', sample: { state: 'agents', look: 'terminal' } },
      { label: 'No-colour output', sample: { state: 'agents', look: 'NO_COLOR' } },
    ],
    links: [
      { slug: 'width-steps', title: 'Width steps' },
      { slug: 'degradation', title: 'Degradation' },
      { slug: 'table', title: 'Table variants' },
      { slug: 'key-help', title: 'Key help' },
    ],
  },
  {
    slug: 'keyboard',
    title: 'Keyboard map',
    lead: 'Expose the effective bindings for the current layer without stealing text-editing keys.',
    section: 'keys',
    problem:
      'People need a predictable base map, but an editor or completion layer must interpret keys differently from a collection.',
    anatomy: patternAnatomy('key-help'),
    rules: [
      'Route keys to the top input owner first. Bindings in help and the footer reflect the effective map, including user overrides.',
      'Reserve navigation keys for the active collection or overlay; let text fields own editing. Follow the documented completion exception for insertion.',
      'Keep essential local actions in the footer and the complete map in Help. Give each hint an intact key/action pair and drop lower-priority pairs when space runs out.',
    ],
    samples: [
      { label: 'Effective Help map', sample: { state: 'help' } },
      { label: 'Settings owns its overlay keys', sample: { state: 'settings-menu' } },
      { label: 'Completion exposes its insertion key', sample: { state: 'mention-picker' } },
    ],
    links: [
      { slug: 'key-help', title: 'Key help variants' },
      { slug: 'text-field', title: 'Text field' },
      { slug: 'completion', title: 'Completion' },
    ],
  },
];
