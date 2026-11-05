import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  Block,
  BlockDocument,
  BlockDropLine,
  BlockGhost,
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
  blockKeyAction,
  nextBlockMenuItem,
  type BlockAction,
  insertGroups,
} from '../src/blocks/index.js';
import { sampleBlocks, type SampleBlock } from './blocks-sample.js';
import './block-editor.css';

/** The editor demo's opening state, so each pattern's frame starts where it shows its rule. */
export type BlockEditorStart =
  | 'document'
  | 'hover'
  | 'insert'
  | 'insert-empty'
  | 'menu'
  | 'drag'
  | 'deleted'
  | 'selection';

type Menu =
  | { kind: 'insert'; at: string; query: string; active?: string }
  | { kind: 'actions'; at: string; active?: string };

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 480px)').matches;

/**
 * The block patterns working together on the sample page, as an editor host would wire the parts:
 * one shared handle that follows the pointer or keyboard focus, the insert menu and the block menu,
 * drag to move with a drop line, delete with Undo, and keyboard selection.
 */
export function BlockEditor({ start = 'document' }: { start?: BlockEditorStart }) {
  const [blocks, setBlocks] = useState<SampleBlock[]>(() =>
    start === 'insert' || start === 'insert-empty'
      ? [
          ...sampleBlocks.slice(0, 3),
          { id: 'b-new', kind: 'text', label: 'Paragraph: empty', body: null },
          ...sampleBlocks.slice(3, 5),
        ]
      : start === 'deleted'
        ? sampleBlocks.filter((block) => block.id !== 'b-6')
        : sampleBlocks,
  );
  const [hovered, setHovered] = useState<string | undefined>(
    start === 'hover' || start === 'drag' ? 'b-3' : undefined,
  );
  const [selected, setSelected] = useState<string[]>(
    start === 'selection' ? ['b-3', 'b-4', 'b-5'] : start === 'menu' ? ['b-6'] : [],
  );
  const [menu, setMenu] = useState<Menu | undefined>(() =>
    start === 'insert'
      ? { kind: 'insert', at: 'b-new', query: 'ta', active: 'table' }
      : start === 'insert-empty'
        ? { kind: 'insert', at: 'b-new', query: 'zz' }
        : start === 'menu'
          ? { kind: 'actions', at: 'b-6', active: 'move-up' }
          : undefined,
  );
  const [undo, setUndo] = useState<{ blocks: SampleBlock[]; message: string } | undefined>(
    start === 'deleted' ? { blocks: sampleBlocks, message: 'Deleted 1 block (Table)' } : undefined,
  );
  const [drag, setDrag] = useState<{ id: string; drop: number; x: number; y: number } | undefined>(
    start === 'drag' ? { id: 'b-3', drop: 6, x: 360, y: 300 } : undefined,
  );
  const doc = useRef<HTMLDivElement>(null);
  // A drag ends with a click on the grip; it must not open the block menu.
  const dragEnded = useRef(false);
  const sheet = narrow();

  const focusBlock = (id: string) =>
    doc.current?.querySelector<HTMLElement>(`[data-block-id="${id}"]`)?.focus();
  // A menu takes focus when it opens or moves to another block, not on every active-item change.
  const openMenu = menu && `${menu.kind}:${menu.at}`;
  useEffect(() => {
    if (openMenu) doc.current?.querySelector<HTMLElement>('.tmt-block-menu')?.focus();
  }, [openMenu]);

  const insertItems = insertGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.label} ${item.shortcut}`
          .toLowerCase()
          .includes(menu?.kind === 'insert' ? menu.query : ''),
      ),
    }))
    .filter((group) => group.items.length);
  const menuIds =
    menu?.kind === 'insert'
      ? insertItems.flatMap((group) => group.items.map((item) => item.id))
      : blockActions.map((action) => action.id);

  const remember = (message: string) => setUndo({ blocks, message });
  const move = (ids: string[], by: number) => {
    const at = blocks.findIndex((block) => block.id === ids[0]);
    const next = blocks.filter((block) => !ids.includes(block.id));
    const moved = blocks.filter((block) => ids.includes(block.id));
    const to = Math.max(0, Math.min(next.length, at + by));
    setBlocks([...next.slice(0, to), ...moved, ...next.slice(to)]);
  };
  const act = (action: BlockAction | 'delete', ids: string[]) => {
    setMenu(undefined);
    if (action === 'move-up') move(ids, -1);
    else if (action === 'move-down') move(ids, 1);
    else if (action === 'duplicate') {
      const at = blocks.findIndex((block) => block.id === ids.at(-1));
      const copies = blocks
        .filter((block) => ids.includes(block.id))
        .map((block) => ({ ...block, id: `${block.id}-copy` }));
      setBlocks([...blocks.slice(0, at + 1), ...copies, ...blocks.slice(at + 1)]);
    } else if (action === 'delete') {
      const kinds = blocks
        .filter((block) => ids.includes(block.id))
        .map((block) => block.label.split(':')[0]);
      remember(`Deleted ${ids.length} block${ids.length > 1 ? 's' : ''} (${kinds.join(', ')})`);
      setBlocks(blocks.filter((block) => !ids.includes(block.id)));
      setSelected([]);
    }
  };
  const restore = () => {
    if (!undo) return;
    setBlocks(undo.blocks);
    setUndo(undefined);
  };
  const insert = (type: string) => {
    if (menu?.kind !== 'insert') return;
    const group = insertGroups.flatMap((g) => g.items).find((item) => item.id === type)!;
    setBlocks(
      blocks.map((block) =>
        block.id === menu.at
          ? {
              ...block,
              kind: 'text',
              label: `${group.label}: new`,
              body: <TextBlock>{`New ${group.label.toLowerCase()} block`}</TextBlock>,
            }
          : block,
      ),
    );
    setMenu(undefined);
  };

  const onMenuKey = (event: KeyboardEvent) => {
    if (!menu) return;
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setMenu({ ...menu, active: nextBlockMenuItem(menuIds, menu.active, event.key) });
    } else if (event.key === 'Enter' && menu.active) {
      event.preventDefault();
      if (menu.kind === 'insert') insert(menu.active);
      else act(menu.active as BlockAction, selected.length ? selected : [menu.at]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const at = menu.at;
      setMenu(undefined);
      focusBlock(at);
    } else if (menu.kind === 'insert' && event.key.length === 1) {
      setMenu({ ...menu, query: menu.query + event.key, active: undefined });
    } else if (menu.kind === 'insert' && event.key === 'Backspace') {
      setMenu({ ...menu, query: menu.query.slice(0, -1) });
    }
    event.stopPropagation();
  };

  const onBlockKey = (id: string) => (event: KeyboardEvent) => {
    const action = blockKeyAction(event, true);
    if (!action) return;
    event.preventDefault();
    const ids = selected.includes(id) ? selected : [id];
    const at = blocks.findIndex((block) => block.id === id);
    const step = (by: number) => blocks[Math.max(0, Math.min(blocks.length - 1, at + by))]!.id;
    if (action === 'menu') setMenu({ kind: 'actions', at: id, active: blockActions[0]!.id });
    else if (action === 'escape') setSelected([]);
    else if (action === 'undo') restore();
    else if (action === 'previous' || action === 'next') {
      const to = step(action === 'previous' ? -1 : 1);
      setSelected([to]);
      focusBlock(to);
    } else if (action === 'extend-previous' || action === 'extend-next') {
      const to = step(action === 'extend-previous' ? -1 : 1);
      setSelected((current) => [...new Set([...(current.length ? current : [id]), to])]);
      focusBlock(to);
    } else act(action, ids);
  };

  const onGrip = (id: string) => (event: PointerEvent<HTMLButtonElement>) => {
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;
    let drop = -1;
    const box = doc.current!.getBoundingClientRect();
    const onMove = (next: globalThis.PointerEvent) => {
      if (!moved && Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < 4) return;
      moved = true;
      const rows = [...doc.current!.querySelectorAll<HTMLElement>('[data-block-id]')];
      drop = rows.findIndex(
        (row) => next.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2,
      );
      if (drop < 0) drop = rows.length;
      setDrag({ id, drop, x: next.clientX - box.left + 12, y: next.clientY - box.top + 8 });
    };
    const onUp = () => {
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      setDrag(undefined);
      dragEnded.current = moved;
      if (!moved || drop < 0) return;
      const from = blocks.findIndex((block) => block.id === id);
      const rest = blocks.filter((block) => block.id !== id);
      const to = drop > from ? drop - 1 : drop;
      setBlocks([...rest.slice(0, to), blocks[from]!, ...rest.slice(to)]);
    };
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
  };

  const menuFor = (id: string): ReactNode => {
    if (menu?.at !== id) return null;
    const floating = sheet ? 'tmt-block-editor-sheet' : 'tmt-block-editor-float';
    if (menu.kind === 'actions')
      return (
        <div className={floating}>
          <BlockMenu
            kind="actions"
            label="Block actions"
            placement={sheet ? 'sheet' : 'below'}
            activeId={menu.active && `menu-${menu.active}`}
            onKeyDown={onMenuKey}
          >
            {blockActions.map((action) => (
              <div key={action.id}>
                {action.id === 'delete' && <BlockMenuSeparator />}
                <BlockMenuItem
                  id={`menu-${action.id}`}
                  shortcut={action.shortcut}
                  danger={action.danger}
                  active={menu.active === action.id}
                  onPointerEnter={() => setMenu({ ...menu, active: action.id })}
                  onClick={() => act(action.id, selected.length ? selected : [id])}
                >
                  {action.label}
                </BlockMenuItem>
              </div>
            ))}
          </BlockMenu>
        </div>
      );
    return (
      <div className={floating}>
        <BlockMenu
          label="Insert block"
          placement={sheet ? 'sheet' : 'below'}
          activeId={menu.active && `insert-${menu.active}`}
          onKeyDown={onMenuKey}
        >
          {insertItems.map((group) => (
            <div key={group.name} role="group" aria-label={group.name}>
              {insertItems.length > 1 && <BlockMenuGroup>{group.name}</BlockMenuGroup>}
              {group.items.map((item) => (
                <BlockMenuItem
                  key={item.id}
                  id={`insert-${item.id}`}
                  icon={item.icon}
                  description={item.description}
                  shortcut={item.shortcut}
                  active={menu.active === item.id}
                  onPointerEnter={() => setMenu({ ...menu, active: item.id })}
                  onClick={() => insert(item.id)}
                >
                  {item.label}
                </BlockMenuItem>
              ))}
            </div>
          ))}
          {!insertItems.length && (
            <BlockMenuEmpty>No block matches “{menu.query}”. Esc closes.</BlockMenuEmpty>
          )}
          {!sheet && (
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
      </div>
    );
  };

  const dragged = drag && blocks.find((block) => block.id === drag.id);
  return (
    <div className="tmt-block-editor" data-sheet={sheet && menu ? '' : undefined}>
      <BlockDocument ref={doc} onPointerLeave={() => setHovered(undefined)}>
        {blocks.map((block, index) => (
          <Fragment key={block.id}>
            {drag?.drop === index && <BlockDropLine />}
            <Block
              data-block-id={block.id}
              label={block.label}
              kind={block.kind}
              level={block.level}
              tabIndex={selected[0] === block.id || (!selected.length && index === 0) ? 0 : -1}
              selected={selected.includes(block.id)}
              state={
                drag?.id === block.id
                  ? 'dragging'
                  : start === 'hover' && hovered === block.id
                    ? 'hover'
                    : undefined
              }
              onPointerEnter={() => setHovered(block.id)}
              onFocus={() => setHovered(block.id)}
              onClick={() => narrow() && setSelected([block.id])}
              onKeyDown={onBlockKey(block.id)}
            >
              {(hovered === block.id || menu?.at === block.id) && (
                <BlockHandle
                  menuOpen={menu?.kind === 'actions' && menu.at === block.id}
                  onInsert={() => setMenu({ kind: 'insert', at: block.id, query: '' })}
                  onMenu={() => {
                    if (dragEnded.current) dragEnded.current = false;
                    else setMenu({ kind: 'actions', at: block.id, active: blockActions[0]!.id });
                  }}
                  onGripPointerDown={onGrip(block.id)}
                />
              )}
              {block.body ?? (
                <TextBlock>
                  {menu?.kind === 'insert' && menu.at === block.id ? `/${menu.query}` : ''}
                </TextBlock>
              )}
              {menuFor(block.id)}
            </Block>
          </Fragment>
        ))}
        {drag?.drop === blocks.length && <BlockDropLine />}
        {dragged && <BlockGhost style={{ left: drag.x, top: drag.y }}>{dragged.label}</BlockGhost>}
      </BlockDocument>
      {undo && (
        <div className="tmt-block-editor-toast">
          <BlockToast onUndo={restore}>{undo.message}</BlockToast>
        </div>
      )}
    </div>
  );
}
