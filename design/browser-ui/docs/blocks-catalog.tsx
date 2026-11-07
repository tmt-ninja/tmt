import { Button } from '../src/ui/index.js';
import { useState } from 'react';
import {
  ImageBlock,
  MarkedText,
  MockupBlock,
  PageView,
  QuestionBlock,
  WorkBundle,
} from '../src/blocks/index.js';
import '../src/blocks/blocks.css';
import type { ComponentDoc } from './catalog.js';

const sampleImage =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"%3E%3Crect width="320" height="180" fill="%23e3e1dc"/%3E%3Crect x="24" y="24" width="272" height="30" fill="%23a29e97"/%3E%3Crect x="24" y="70" width="160" height="80" fill="%23cfccc6"/%3E%3C/svg%3E';
function QuestionDemo() {
  const [answer, setAnswer] = useState('');
  return (
    <QuestionBlock
      title="Which screen should we build first?"
      agent="tmt-gui-lead"
      choices={['Insert menu', 'Block handle']}
      state={answer ? 'answered' : 'waiting'}
      answer={answer}
      onSend={(result) => setAnswer(result.other || result.choices.join(', '))}
    />
  );
}
function PageViewControlsDemo() {
  const [filters, setFilters] = useState([{ id: 'project', label: 'Project: spec' }]);
  const rows = [
    {
      id: 'one',
      name: 'Structured pages',
      title: 'Structured pages',
      projects: ['spec'],
      stage: { id: 'open', label: 'Awaiting decision' },
      updated: '11 minutes ago',
      author: 'tmt-gui-lead',
      access: 'Team',
    },
    {
      id: 'two',
      name: 'Night execution plan',
      title: 'Night execution plan',
      projects: ['night'],
      stage: { id: 'active', label: 'In progress' },
      updated: '2 hours ago',
      author: 'night-lead',
      access: 'Team',
    },
  ];
  return (
    <PageView
      title="Spec pages"
      filters={filters}
      rows={rows}
      onRemoveFilter={(id) => setFilters((items) => items.filter((item) => item.id !== id))}
    />
  );
}
const images = [
  {
    src: sampleImage,
    alt: 'A sample page in light mode',
    caption: '390 · light',
    tag: '✓ Matches',
  },
  { src: sampleImage, alt: 'A sample page in dark mode', caption: '1440 · dark', tag: '◆ Review' },
];
const entry = (name: string) =>
  `import { ${name} } from '@tmt/browser-ui/blocks';\nimport '@tmt/browser-ui/blocks.css';\n\n`;
export const blockComponents: ComponentDoc[] = [
  {
    slug: 'question-block',
    name: 'Question block',
    description:
      'A presentational question with choices or a short answer; Other provides a text answer. In Colab, use tmt-question for persistent questions and answers.',
    preview: () => <QuestionDemo />,
    usage: `${entry('QuestionBlock')}<QuestionBlock title="Which screen first?" agent="gui-lead" choices={['Insert', 'Handle']} onSend={sendAnswer} />`,
    variants: [
      [
        'Answered',
        () => (
          <QuestionBlock
            title="Which screen first?"
            agent="gui-lead"
            state="answered"
            answer="Insert"
          />
        ),
      ],
      [
        'Short answer',
        () => (
          <QuestionBlock
            title="What should change?"
            agent="gui-lead"
            kind="short"
            onSend={() => {}}
          />
        ),
      ],
    ],
  },
  {
    slug: 'image-block',
    name: 'Image block',
    description: 'A compact image collection with captions, a viewer and optional file cards.',
    preview: () => <ImageBlock images={images} />,
    usage: `${entry('ImageBlock')}<ImageBlock images={images} layout="carousel" />`,
    variants: [
      ['Grid', () => <ImageBlock images={images} layout="grid" />],
      [
        'File',
        () => (
          <ImageBlock
            variant="file"
            images={[]}
            files={[
              {
                name: 'specification.md',
                type: 'Markdown',
                size: '21 B',
                href: 'data:text/plain,Example%20specification',
              },
            ]}
          />
        ),
      ],
    ],
  },
  {
    slug: 'mockup-block',
    name: 'Mockup block',
    description: 'A sized design-system stage with device widths and theme controls.',
    preview: () => (
      <MockupBlock height={240}>
        <div style={{ padding: 'var(--tmt-ui-space-m)' }}>
          <p>◆ Needs you · Approve the release notes</p>
          <h3>Release 0.4.2</h3>
          <p>2 checks</p>
          <div className="docs-row">
            <Button size="sm">Approve</Button>
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </div>
        </div>
      </MockupBlock>
    ),
    usage: `${entry('MockupBlock')}<MockupBlock system="tmt-gui" version="follow">…</MockupBlock>`,
    variants: [['Unavailable version', () => <MockupBlock unavailable />]],
  },
  {
    slug: 'work-bundle',
    name: 'Work bundle',
    description:
      'A page reference with its admitted metadata and independently retained work. ConnectedWorkBundle subscribes through the host’s read-only source.',
    preview: () => (
      <WorkBundle
        page="example"
        number={3}
        data={{
          title: 'Build the shared menu',
          href: '#',
          summary: 'A responsive menu for the Colab workspace.',
          projects: ['gui'],
          stage: 'In progress',
          owner: 'gui-3',
          needsYou: true,
          updated: '20 min ago',
        }}
        work="Start with the phone drawer."
        tickets={[{ label: '#5972', href: 'https://github.com/tmt-ninja/tmt/issues/5972' }]}
        onOpenTicket={(ticket) => {
          if (window.confirm(`Open ${ticket.label} on GitHub?`))
            window.open(ticket.href, '_blank', 'noopener');
        }}
      />
    ),
    usage: `${entry('WorkBundle')}<WorkBundle page="page-id" data={page} work="Start with the phone drawer." />`,
    variants: [
      [
        'Unavailable page',
        () => <WorkBundle page="missing" state="unavailable" work="Keep this work." />,
      ],
    ],
  },
  {
    slug: 'page-view',
    name: 'Page view',
    description:
      'Filter, group and choose visible columns for a shared page list. PageViewToolbar provides the controls; the host owns the data. authoredPageViewRows reads a view’s authored rows as plain values, filtered, sorted and cut at its limit.',
    preview: () => <PageViewControlsDemo />,
    usage: `${entry('PageView')}<PageView title="Spec pages" rows={pages} />\n<PageView title="Snapshot" rows={authoredPageViewRows(props.rows, { sort: 'title' })} />`,
    variants: [],
  },
  {
    slug: 'marked-text',
    name: 'Marked text',
    description:
      'A block’s text with its inline marks: bold, italic and inline code, a link, and @agent or @block mentions. Offsets count scalar values. A link draws only for an https, http or mailto URL (linkHref) and opens through the host’s onLink; anything else is plain text.',
    preview: () => (
      <p>
        <MarkedText
          text="Ship the stack today, see the spec."
          marks={[
            { from: 0, to: 4, mark: 'bold' },
            { from: 9, to: 14, mark: 'code' },
            { from: 15, to: 20, mark: 'italic' },
            { from: 26, to: 34, mark: 'link', value: 'https://example.com/spec' },
          ]}
          onLink={(href) => window.open(href, '_blank', 'noopener')}
        />
      </p>
    ),
    usage: `${entry('MarkedText')}<MarkedText text={text} marks={marks} onLink={openLink} />`,
    variants: [
      [
        'A script link draws as text',
        () => (
          <p>
            <MarkedText
              text="This link never opens."
              marks={[{ from: 5, to: 9, mark: 'link', value: 'javascript:alert(1)' }]}
            />
          </p>
        ),
      ],
    ],
  },
];
