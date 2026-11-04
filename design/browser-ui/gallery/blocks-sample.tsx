import type { ReactNode } from 'react';
import { CircleHelp, Code2, Heading2, ListChecks, Table2, Text } from 'lucide-react';
import {
  BlockMention,
  Callout,
  CardBlock,
  CodeBlock,
  HeadingBlock,
  ListItemBlock,
  TableBlock,
  TextBlock,
  TodoBlock,
  type BlockKind,
} from '../src/blocks/index.js';

/** One block of the sample page: its kind, its accessible label and its content. */
export interface SampleBlock {
  id: string;
  kind: BlockKind;
  label: string;
  level?: 2 | 3;
  body: ReactNode;
}

const tag = (text: string) => <span className="tmt-ui-tag">{text}</span>;

export const ticketTable = (
  <TableBlock
    label="Ticket status"
    columns={[
      { name: 'Ticket', nowrap: true },
      { name: 'Owner', nowrap: true },
      { name: 'State', nowrap: true },
      { name: 'Note', hideNarrow: true },
    ]}
    rows={[
      ['#5980 DsScope', tag('gui-3'), '● Working', 'The default frame of the mockup block'],
      ['#5981 Block parts', tag('gui-2'), '◆ Waiting', 'The parts on this page'],
      [
        '#5922 Epic',
        tag('tmt-gui-lead'),
        '● Working',
        'A long note that wraps: static parts first, the editor after them',
      ],
    ]}
  />
);

/** The sample page every block frame and pattern draws: filled, long and nested content. */
export const sampleBlocks: SampleBlock[] = [
  {
    id: 'b-1',
    kind: 'heading',
    level: 2,
    label: 'Heading: First block set',
    body: (
      <HeadingBlock level={2}>
        First block set: Colab and the design system own the look, authors fill in content
      </HeadingBlock>
    ),
  },
  {
    id: 'b-2',
    kind: 'text',
    label: 'Paragraph: Blocks read as one document',
    body: (
      <TextBlock>
        Blocks read as one document: no borders, fills or boxes between them. A paragraph can hold{' '}
        <strong>bold</strong>, <em>italic</em>,{' '}
        <code className="tmt-ui-code">tmt colab block ls</code> and a chip for a block,{' '}
        <BlockMention icon={<Table2 />} href="#b-6">
          Table: Ticket status
        </BlockMention>
        .
      </TextBlock>
    ),
  },
  {
    id: 'b-3',
    kind: 'list-item',
    label: 'List item: Post the plan on the issue first',
    body: (
      <ListItemBlock>
        Post the plan on the issue first, then build each part with its catalog entry
      </ListItemBlock>
    ),
  },
  {
    id: 'b-4',
    kind: 'list-item',
    label: 'List item: Every pull request carries captures',
    body: (
      <ListItemBlock indent={1}>
        Every pull request carries captures at 390 and 1440, light and dark
      </ListItemBlock>
    ),
  },
  {
    id: 'b-5',
    kind: 'todo',
    label: 'To-do: Move the question card into the design system',
    body: (
      <TodoBlock checked assignee={tag('gui-3')} due="11-03">
        Move the question card into the design system
      </TodoBlock>
    ),
  },
  {
    id: 'b-6',
    kind: 'table',
    label: 'Table: Ticket status',
    body: ticketTable,
  },
  {
    id: 'b-7',
    kind: 'callout',
    label: 'Callout: Waiting on you',
    body: (
      <Callout tone="waiting" heading="Look on the local site before merging">
        The pull request stays a draft until the trial build is checked.
      </Callout>
    ),
  },
  {
    id: 'b-8',
    kind: 'code',
    label: 'Code: answered-strip.css',
    body: (
      <CodeBlock
        filename="extensions/tmt-colab/typescript/app/src/components/answered-strip.css"
        language="CSS"
        text={
          '.answered-strip.question-line {\n  display: flex; align-items: center; gap: 8px; height: 30px; min-width: 0;\n}'
        }
      />
    ),
  },
];

/** Each part's filled states, for its catalog entry and the tmt GUI captures. */
export const partStates: Record<string, [string, ReactNode][]> = {
  heading: [
    [
      'Level 2 (##), long',
      <HeadingBlock key="k-long" level={2}>
        First block set: Colab and the design system own the look, authors fill in content
      </HeadingBlock>,
    ],
    [
      'Level 3 (###)',
      <HeadingBlock key="k0" level={3}>
        One level smaller
      </HeadingBlock>,
    ],
    ['Empty', <HeadingBlock key="k1" level={2} />],
  ],
  text: [
    ['Default, with inline formats and an @block chip', sampleBlocks[1]!.body],
    [
      'Muted',
      <TextBlock key="k2" tone="muted">
        Secondary notes use the muted tone.
      </TextBlock>,
    ],
    ['Empty', <TextBlock key="k3" />],
  ],
  'list-item': [
    [
      'Bullets, nested',
      <>
        {sampleBlocks[2]!.body}
        {sampleBlocks[3]!.body}
        <ListItemBlock indent={2}>Third level, the deepest</ListItemBlock>
      </>,
    ],
    [
      'Numbered',
      <>
        <ListItemBlock marker="number" number={1}>
          Plan on the issue
        </ListItemBlock>
        <ListItemBlock marker="number" number={2}>
          Captures on every pull request
        </ListItemBlock>
      </>,
    ],
  ],
  todo: [
    [
      'Done, open, overdue and waiting',
      <>
        {sampleBlocks[4]!.body}
        <TodoBlock assignee={tag('gui-2')} due="11-04">
          Page-list view: filters, grouping and sub-page progress, sharing one part with the page
          list
        </TodoBlock>
        <TodoBlock assignee={tag('gui-2')} due="✗ Overdue 11-02" overdue>
          Captures at 390 and 1440, light and dark
        </TodoBlock>
        <TodoBlock due="◆ Waiting for review">Review the block shell</TodoBlock>
      </>,
    ],
  ],
  table: [['Hidden column under 480px, cells that never wrap', ticketTable]],
  card: [
    [
      'Card with nested blocks',
      <CardBlock
        key="k4"
        title="A long card title wraps, and its meta follows on the right or drops below"
        meta="3 blocks"
      >
        <TextBlock>A paragraph in the card.</TextBlock>
        <ListItemBlock>A list item in the card</ListItemBlock>
        <Callout tone="working">A callout in the card.</Callout>
      </CardBlock>,
    ],
    [
      'Section: a label, no frame',
      <CardBlock key="k5" variant="section" title="Section">
        <TextBlock>Only a label heading and no frame, to group cards.</TextBlock>
      </CardBlock>,
    ],
  ],
  callout: [
    [
      'Four tones, with and without a heading',
      <>
        {sampleBlocks[6]!.body}
        <Callout tone="working">gui-3 is merging origin/main into the stack.</Callout>
        <Callout tone="review">tmt-gui-lead is reviewing #5984.</Callout>
        <Callout tone="blocked">
          The mockup block waits for #5980; a long body wraps as usual and is never cut.
        </Callout>
      </>,
    ],
  ],
  code: [
    ['With a filename', sampleBlocks[7]!.body],
    [
      'Language only, copied',
      <CodeBlock key="k6" language="Shell" copied text="pnpm --filter @tmt/browser-ui test" />,
    ],
    [
      'Command',
      <CodeBlock
        key="k7"
        variant="command"
        text="tmt colab block insert 838644c2 --type table --after b-12 --json"
      />,
    ],
  ],
  mention: [
    [
      'In a paragraph, and as a draft in a comment',
      <>
        <TextBlock>
          See{' '}
          <BlockMention icon={<Table2 />} href="#b-6">
            Table: Ticket status
          </BlockMention>{' '}
          and{' '}
          <BlockMention icon={<ListChecks />} href="#b-5">
            To-do: Move the question card into the design system
          </BlockMention>
          .
        </TextBlock>
        <div className="tmt-ui-field-control">
          Make <BlockMention icon={<Table2 />}>Table: Ticket status</BlockMention> look like the
          list
        </div>
      </>,
    ],
  ],
};

/** The insert menu's types, in their groups. */
export const insertGroups: {
  name: string;
  items: { id: string; label: string; description: string; shortcut: string; icon: ReactNode }[];
}[] = [
  {
    name: 'Basic',
    items: [
      {
        id: 'text',
        label: 'Paragraph',
        description: 'Plain text',
        shortcut: '/text',
        icon: <Text />,
      },
      {
        id: 'heading',
        label: 'Heading',
        description: '## or ###',
        shortcut: '##',
        icon: <Heading2 />,
      },
      {
        id: 'table',
        label: 'Table',
        description: 'Columns and rows',
        shortcut: '/table',
        icon: <Table2 />,
      },
      {
        id: 'todo',
        label: 'To-do',
        description: 'Items to check off',
        shortcut: '[]',
        icon: <ListChecks />,
      },
    ],
  },
  {
    name: 'Structure',
    items: [
      {
        id: 'question',
        label: 'Question',
        description: 'Choices or a short answer',
        shortcut: '/q',
        icon: <CircleHelp />,
      },
      {
        id: 'code',
        label: 'Code',
        description: 'A file or a command',
        shortcut: '```',
        icon: <Code2 />,
      },
    ],
  },
];
