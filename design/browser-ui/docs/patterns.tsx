import { useState, type ReactNode } from 'react';
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '../src/ui/index.js';
import { follow } from './router.js';
import { colabMockBase } from './routes.js';
import { BrowserPageRow, BrowserStatusLine } from '../src/pattern-parts/index.js';
import { BrowserAvatar, BrowserToggle } from '../src/react.js';

function SharedPartsPreview() {
  const [pressed, setPressed] = useState(false);
  return (
    <div className="docs-canvas">
      <BrowserAvatar name="tmt-ux-lead" kind="agent" />
      <BrowserToggle
        label="Compact view"
        pressed={pressed}
        onActivate={() => setPressed(!pressed)}
      />
      <BrowserPageRow
        title="Release plan"
        tags={['spec']}
        updated="2 min ago"
        href={`${colabMockBase}/page`}
        onFollow={follow}
      />
    </div>
  );
}

/** A list row: title, tags, time and an unread state in weight alone. */
export function PageRow({
  title,
  tags,
  updated,
  unread = false,
  state,
}: {
  title: string;
  tags: string[];
  updated: string;
  unread?: boolean;
  state?: 'waiting' | 'blocked';
}) {
  return (
    <BrowserPageRow
      title={title}
      tags={tags}
      updated={updated}
      unread={unread}
      state={state}
      href={`${colabMockBase}/page`}
      onFollow={follow}
    />
  );
}

export const patterns: { slug: string; title: string; lead: string; render(): ReactNode }[] = [
  {
    slug: 'list-row',
    title: 'List row',
    lead: 'One object per row: its title first, then tags and time. Unread is bold, never a colour; a state carries its mark.',
    render: () => (
      <div className="docs-canvas docs-canvas-flush">
        <PageRow title="Release plan" tags={['spec', 'tmt']} updated="2 min ago" unread />
        <PageRow title="Theme B review" tags={['design']} updated="1 h ago" state="waiting" />
        <PageRow title="CI flake triage" tags={['infra']} updated="Yesterday" state="blocked" />
      </div>
    ),
  },
  {
    slug: 'empty-state',
    title: 'Empty state',
    lead: 'Say what would be here and give one way to add it.',
    render: () => (
      <div className="docs-canvas">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No pages in this project</EmptyTitle>
            <EmptyDescription>Move a page here, or start one from a template.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" variant="outline" size="sm">
              New page
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    ),
  },
  {
    slug: 'status-line',
    title: 'Status line',
    lead: 'States are a mark plus a word in their muted hue. The accent never colours a state.',
    render: () => (
      <div className="docs-canvas">
        <BrowserStatusLine
          items={[
            { tone: 'working', label: 'Working' },
            { tone: 'waiting', label: 'Waiting on you' },
            { tone: 'review', label: 'In review' },
            { tone: 'blocked', label: 'Blocked' },
          ]}
        />
      </div>
    ),
  },
  {
    slug: 'planned',
    title: 'Planned parts',
    lead: 'Shared parts replace the earlier mock-up stand-ins and can be composed in real pages.',
    render: () => <SharedPartsPreview />,
  },
];
