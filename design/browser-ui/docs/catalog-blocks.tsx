import type { ReactNode } from 'react';
import { ScaledFrame } from '../gallery/kit.js';
import { partStates } from '../gallery/blocks-sample.js';
import { Block, BlockDocument, BlockHandle, BlockToast, TextBlock } from '../src/blocks/index.js';
import type { ComponentDoc } from './catalog.js';
import { guiRoot } from './routes.js';

const importLine = (...names: string[]) =>
  `import { ${names.join(', ')} } from '@tmt/browser-ui/blocks';\n\n`;

/** A part's frames: 1440 and 390, light and dark, from the gallery's blocks frame. */
const frames = (part: string, title: string, height: number): [string, () => ReactNode][] =>
  ([1440, 390] as const).map((width) => [
    `${width}, light and dark`,
    () => (
      <div className="docs-frame-pair">
        {(['light', 'dark'] as const).map((theme) => (
          <ScaledFrame
            key={theme}
            title={`${title} ${width} ${theme}`}
            src={`${guiRoot}?frame=blocks&part=${part}&theme=${theme}`}
            width={width}
            height={width === 390 ? Math.round(height * 1.6) : height}
          />
        ))}
      </div>
    ),
  ]);

const inDoc = (part: string) => () => (
  <BlockDocument>
    {(partStates[part] ?? []).map(([title, body]) => (
      <Block key={title} label={title}>
        {body}
      </Block>
    ))}
  </BlockDocument>
);

/** The structured-page blocks (#5981): one entry per part, all from `@tmt/browser-ui/blocks`. */
export const blockComponents: ComponentDoc[] = [
  {
    slug: 'block-document',
    name: 'Block document',
    description:
      'The page column the blocks sit in: it holds the gutter for the one shared handle and is the container whose width decides the phone layout (480px), so a block page in a narrow pane collapses like a phone. Its stylesheet carries every block part.',
    preview: inDoc('text'),
    usage: `${importLine('BlockDocument', 'Block', 'TextBlock')}<BlockDocument>
  <Block label="Paragraph: Blocks read as one document"><TextBlock>…</TextBlock></Block>
</BlockDocument>`,
    variants: frames('text', 'Block document', 300),
  },
  {
    slug: 'block',
    name: 'Block shell',
    description:
      'Every block sits in the shell, and the shell draws nothing at rest: no border, fill or box, so the page reads as one document. Hover gives a light tint and selection a deeper one, never a border; the focus ring shows only for the keyboard. Each editor renders one BlockHandle (insert and the block menu, which is also the drag grip) inside the hovered or focused block, in the gutter 8px to its left. Under 480px of document width the handle hides: a tap selects and a long press opens the block menu as a sheet.',
    preview: () => (
      <BlockDocument>
        <Block label="Paragraph: idle">
          <TextBlock>Idle: no handle, no fill.</TextBlock>
        </Block>
        <Block label="Paragraph: hover" state="hover">
          <BlockHandle />
          <TextBlock>Hover: the tint, and the one shared handle in the gutter.</TextBlock>
        </Block>
        <Block label="Paragraph: selected" selected>
          <TextBlock>Selected: the selection tint, no border.</TextBlock>
        </Block>
      </BlockDocument>
    ),
    usage: `${importLine('BlockDocument', 'Block', 'BlockHandle', 'BlockDropLine', 'BlockGhost', 'blockKeyAction')}<BlockDocument>
  <Block label="Table: Ticket status" kind="table" selected={selected} tabIndex={-1}
    onKeyDown={(event) => run(blockKeyAction(event, selecting))}>
    {hovered && <BlockHandle onInsert={openInsert} onMenu={openMenu} onGripPointerDown={startDrag} />}
    <TableBlock … />
  </Block>
</BlockDocument>
// While dragging: the dragged block takes state="dragging", BlockDropLine marks the landing place
// and BlockGhost follows the pointer.`,
    variants: [
      ...frames('block', 'Block shell', 420),
      [
        'Keyboard contract (blockKeyAction)',
        () => (
          <ul className="docs-list">
            <li>
              Menu, Shift+F10 or Cmd/Ctrl+/ open the block menu from the focused block; the handle
              is not in the Tab order.
            </li>
            <li>
              Esc leaves typing and selects the block; ↑ and ↓ move the selection, Shift+↑↓ extend
              it.
            </li>
            <li>
              Alt+Shift+↑↓ move the selection; Cmd/Ctrl+D duplicates; Delete deletes; Cmd/Ctrl+Z
              undoes.
            </li>
          </ul>
        ),
      ],
    ],
    dos: [
      ['do', 'Render one handle per editor and move it to the hovered or focused block.'],
      ['dont', 'Draw a border or a resting fill around a block; only the card block has a frame.'],
    ],
  },
  {
    slug: 'block-menu',
    name: 'Block menus',
    description:
      'BlockMenu is the insert menu (a listbox opened by / or the handle’s +, filtered as the person types) and, with kind="actions", the block menu (Move to…, Move up, Move down, Duplicate, Copy link to block, @ this block in a comment, Delete; never "turn into"). Focus stays in the editor: the host drives the active item with nextBlockMenuItem and names it with activeId. On a phone it is a bottom sheet with 44px rows. insertGroups is the one catalog of insert types (icon, description, shortcut, group); items draws catalog rows by label, which is how the block-menu tag shows the same rows.',
    preview: () => <p>See the frames below: a floating menu needs its own page.</p>,
    usage: `${importLine('BlockMenu', 'BlockMenuGroup', 'BlockMenuItem', 'BlockMenuSeparator', 'BlockMenuEmpty', 'BlockMenuFooter', 'BlockKbd', 'blockActions', 'insertGroups', 'nextBlockMenuItem')}<BlockMenu label="Insert block" activeId={\`insert-\${active}\`} placement={phone ? 'sheet' : 'below'}>
  <BlockMenuGroup>Basic</BlockMenuGroup>
  <BlockMenuItem id="insert-table" icon={<Table2 />} description="Columns and rows" shortcut="/table" active>Table</BlockMenuItem>
  {!matches.length && <BlockMenuEmpty>No block matches.</BlockMenuEmpty>}
  <BlockMenuFooter><span><BlockKbd>↑↓</BlockKbd> choose</span></BlockMenuFooter>
</BlockMenu>
<BlockMenu kind="actions" label="Block actions">
  {blockActions.map((action) => <BlockMenuItem key={action.id} shortcut={action.shortcut} danger={action.danger}>{action.label}</BlockMenuItem>)}
</BlockMenu>  // BlockMenuSeparator goes before Delete
<BlockMenu label="Insert block" placement="sheet" items={['Paragraph', 'Heading', 'Table']} activeItem="Table" />  // rows from insertGroups`,
    variants: frames('menu', 'Block menus', 1500),
  },
  ...(
    [
      [
        'heading-block',
        'Heading block',
        'heading',
        'HeadingBlock',
        '## and ### only: the page title is the GUI header’s, never a block. Long headings wrap.',
        '<HeadingBlock level={2}>First block set</HeadingBlock>',
        260,
      ],
      [
        'text-block',
        'Paragraph block',
        'text',
        'TextBlock',
        'Plain text with a few inline formats (bold, italic, inline code, links, @agent and @block chips), default or muted; empty, it shows its placeholder.',
        '<TextBlock tone="muted">Secondary notes</TextBlock>',
        300,
      ],
      [
        'list-item',
        'List item block',
        'list-item',
        'ListItemBlock',
        'One item is one block, so each moves and is mentioned on its own. Bullet or number, three indent levels (24px each, 16px on a phone).',
        '<ListItemBlock indent={1}>A nested item</ListItemBlock>',
        300,
      ],
      [
        'todo',
        'To-do block',
        'todo',
        'TodoBlock',
        'The shared checkbox and the item text, struck through when done, with an assignee and a due date; overdue adds the blocked colour to text that already says so. On a phone the meta moves under the text.',
        '<TodoBlock checked assignee={<Tag>gui-3</Tag>} due="11-03">Move the question card</TodoBlock>',
        300,
      ],
      [
        'table-block',
        'Table block',
        'table',
        'TableBlock',
        'The shared table. A column marked hideNarrow leaves the view while the block itself is narrower than 480px (a container query, not the viewport); its cells stay in the DOM. Tall tables scroll inside the block. With no rows, empty is its one row (the editor’s Add a row).',
        "<TableBlock label=\"Ticket status\" columns={[{ name: 'Ticket', nowrap: true }, { name: 'Note', hideNarrow: true }]} rows={rows} />",
        260,
      ],
      [
        'card-block',
        'Card block',
        'card',
        'CardBlock',
        'The only block that nests (one level) and the only one that draws a frame; resting, it has no shadow. The section variant is a label with no frame, to group cards.',
        '<CardBlock title="First block set" meta="3 blocks">{children}</CardBlock>',
        460,
      ],
      [
        'callout',
        'Callout block',
        'callout',
        'Callout',
        'The shared tinted notice in four tones (working, waiting, review, blocked), each with its mark and word (calloutLabels) so colour is never alone; role note.',
        '<Callout tone="waiting" heading="Look before merging">The pull request stays a draft.</Callout>',
        520,
      ],
      [
        'code-block',
        'Code block',
        'code',
        'CodeBlock',
        'A header with the filename (cut with an ellipsis), the language and Copy, over wrapped monospace text; the host copies and sets copied. variant="command" is the shared one-line command.',
        '<CodeBlock filename="answered-strip.css" language="CSS" text={source} onCopy={copy} copied={copied} />',
        420,
      ],
      [
        'block-mention',
        '@block chip',
        'mention',
        'BlockMention',
        'A chip naming a block by its type and opening text, in a paragraph or a comment; with href it scrolls to the block and selects it.',
        '<BlockMention icon={<Table2 />} href="#b-6">Table: Ticket status</BlockMention>',
        220,
      ],
    ] as const
  ).map(([slug, name, part, component, description, example, height]): ComponentDoc => ({
    slug,
    name,
    description,
    preview: inDoc(part),
    usage: `${importLine(component)}${example}`,
    variants: frames(part, name, height),
  })),
  {
    slug: 'block-toast',
    name: 'Undo toast',
    description:
      'The status line after a delete or a move, with Undo and its key. The host places it at the bottom centre, times it out and restores the blocks; Cmd/Ctrl+Z does the same.',
    preview: () => <BlockToast>Deleted 1 block (Table)</BlockToast>,
    usage: `${importLine('BlockToast')}<BlockToast onUndo={restore}>Deleted 1 block (Table)</BlockToast>`,
    variants: frames('toast', 'Undo toast', 200),
  },
];
