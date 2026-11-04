import type { ReactNode } from 'react';
import { UiTheme } from '../src/ui/index.js';
import {
  Block,
  BlockDocument,
  BlockDropLine,
  BlockHandle,
  BlockKbd,
  BlockMenu,
  BlockMenuEmpty,
  BlockMenuFooter,
  BlockMenuGroup,
  BlockMenuItem,
  BlockMenuSeparator,
  BlockToast,
  TextBlock,
  blockActions,
} from '../src/blocks/index.js';
import { BlockEditor, type BlockEditorStart } from './block-editor.js';
import { insertGroups, partStates } from './blocks-sample.js';

const shellStates: [string, ReactNode][] = [
  [
    'Idle: no handle, no fill, no border',
    <Block key="k0" label="Paragraph: idle">
      <TextBlock>Idle: no handle, no fill.</TextBlock>
    </Block>,
  ],
  [
    'Hover: the tint, and the shared handle in the gutter',
    <Block key="k1" label="Paragraph: hover" state="hover">
      <BlockHandle />
      <TextBlock>
        Hover: a light tint; the one shared handle moves into the gutter, 8px from the block.
      </TextBlock>
    </Block>,
  ],
  [
    'Selected: a deeper tint, no border',
    <Block key="k2" label="Paragraph: selected" selected>
      <TextBlock>Selected: the selection tint, no outline.</TextBlock>
    </Block>,
  ],
  [
    'Dragging, with the drop line',
    <>
      <Block label="Paragraph: dragging" state="dragging">
        <TextBlock>Dragging: half transparent.</TextBlock>
      </Block>
      <BlockDropLine />
    </>,
  ],
  [
    'Read-only: no hover, no handle',
    <Block key="k3" label="Paragraph: read-only" readonly>
      <TextBlock>Read-only.</TextBlock>
    </Block>,
  ],
];

const insertMenu = (placement: 'below' | 'sheet', query = '') => {
  const groups = insertGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(query)),
    }))
    .filter((group) => group.items.length);
  const first = groups[0]?.items[0]?.id;
  return (
    <BlockMenu label="Insert block" placement={placement} activeId={first && `insert-${first}`}>
      {groups.map((group) => (
        <div key={group.name} role="group" aria-label={group.name}>
          {groups.length > 1 && <BlockMenuGroup>{group.name}</BlockMenuGroup>}
          {group.items.map((item) => (
            <BlockMenuItem
              key={item.id}
              id={`insert-${item.id}`}
              icon={item.icon}
              description={item.description}
              shortcut={item.shortcut}
              active={item.id === first}
            >
              {item.label}
            </BlockMenuItem>
          ))}
        </div>
      ))}
      {!groups.length && <BlockMenuEmpty>No block matches “{query}”. Esc closes.</BlockMenuEmpty>}
      {placement !== 'sheet' && (
        <BlockMenuFooter>
          <span>
            <BlockKbd>↑↓</BlockKbd> choose
          </span>
          <span>
            <BlockKbd>Enter</BlockKbd> insert
          </span>
          <span>
            <BlockKbd>Esc</BlockKbd> close
          </span>
        </BlockMenuFooter>
      )}
    </BlockMenu>
  );
};

const actionsMenu = (
  <BlockMenu kind="actions" label="Block actions">
    {blockActions.map((action) => (
      <div key={action.id}>
        {action.id === 'delete' && <BlockMenuSeparator />}
        <BlockMenuItem
          shortcut={action.shortcut}
          danger={action.danger}
          active={action.id === 'move-up'}
        >
          {action.label}
        </BlockMenuItem>
      </div>
    ))}
  </BlockMenu>
);

const ownStates: Record<string, [string, ReactNode][]> = {
  block: shellStates,
  menu: [
    ['Insert menu, all types', insertMenu('below')],
    ['Filtered to one group', insertMenu('below', 'ta')],
    ['No match', insertMenu('below', 'zz')],
    ['Phone sheet', insertMenu('sheet')],
    ['Block menu (handle, Menu key, Shift+F10, Cmd/Ctrl+/)', actionsMenu],
  ],
  toast: [
    ['After a delete', <BlockToast key="k4">Deleted 1 block (Table)</BlockToast>],
    [
      'A long message wraps',
      <BlockToast key="k5">
        Deleted 3 blocks (List item, List item, To-do) from the card First block set
      </BlockToast>,
    ],
  ],
};

/** One block part in its filled states (`part`), or the editor demo (`part=editor&state=`). */
export function BlocksFrame({ params }: { params: URLSearchParams }) {
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const part = params.get('part') ?? 'block';
  if (part === 'editor')
    return (
      <UiTheme theme={theme}>
        <BlockEditor start={(params.get('state') ?? 'document') as BlockEditorStart} />
      </UiTheme>
    );
  const states = ownStates[part] ?? partStates[part];
  if (!states) return <p>Unknown block part {part}</p>;
  return (
    <UiTheme theme={theme}>
      <main className="tmt-blocks-frame">
        {states.map(([title, body]) => (
          <section key={title} className="tmt-blocks-frame-state">
            <h2 className="tmt-blocks-frame-title">{title}</h2>
            <BlockDocument>
              {part === 'block' ? body : <Block label={title}>{body}</Block>}
            </BlockDocument>
          </section>
        ))}
      </main>
    </UiTheme>
  );
}
