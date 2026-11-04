import './manage-list.css';
import { ArrowDown, ArrowUp, Bookmark, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../ui/button.js';

export interface BrowserManageListItem {
  id: string;
  label: string;
  detail: string;
}
export interface BrowserManageListProps {
  items: readonly BrowserManageListItem[];
  onEdit(id: string, origin: 'name' | 'edit'): void;
  onDelete(id: string): boolean;
  emptyFocus?(): HTMLElement | null;
  onMove(id: string, direction: -1 | 1): void;
  onReorder(id: string, before: string): void;
}
/** A host-owned ordered collection: commands and persistence remain with the caller. */
export function BrowserManageList({
  items,
  onEdit,
  onDelete,
  emptyFocus,
  onMove,
  onReorder,
}: BrowserManageListProps) {
  const [drag, setDrag] = useState<string>();
  const root = useRef<HTMLUListElement>(null);
  const deleted = useRef<{ id: string; next?: string } | undefined>(undefined);
  useLayoutEffect(() => {
    const pending = deleted.current;
    if (!pending || items.some((item) => item.id === pending.id)) return;
    deleted.current = undefined;
    const row = [...(root.current?.querySelectorAll<HTMLElement>('li[data-id]') ?? [])].find(
      (node) => node.dataset.id === pending.next,
    );
    (row?.querySelector<HTMLButtonElement>('.tmt-ui-manage-name') ?? emptyFocus?.())?.focus({
      preventScroll: true,
    });
  }, [items, emptyFocus]);
  return (
    <ul ref={root} className="tmt-ui-manage-list">
      {items.map((item, index) => (
        <li
          key={item.id}
          data-id={item.id}
          draggable
          onDragStart={(event) => {
            if (!event.isTrusted) return event.preventDefault();
            event.dataTransfer.setData('text/plain', item.id);
            setDrag(item.id);
          }}
          onDragEnd={() => setDrag(undefined)}
          onDragOver={(event) => {
            if (drag && event.isTrusted) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (drag && event.isTrusted) onReorder(drag, item.id);
            setDrag(undefined);
          }}
        >
          <GripVertical className="tmt-ui-manage-grip" aria-hidden="true" />
          <Bookmark className="tmt-ui-manage-icon" aria-hidden="true" />
          <button
            className="tmt-ui-manage-name"
            aria-label={item.label}
            type="button"
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onClick={(event) => {
              if (event.isTrusted) onEdit(item.id, 'name');
            }}
            onKeyDown={(event) => {
              if (
                event.isTrusted &&
                event.altKey &&
                (event.key === 'ArrowUp' || event.key === 'ArrowDown')
              ) {
                event.preventDefault();
                onMove(item.id, event.key === 'ArrowUp' ? -1 : 1);
              }
            }}
          >
            <b>{item.label}</b>
            <code>{item.detail}</code>
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${item.label} up`}
            disabled={index === 0}
            onClick={(event) => {
              if (event.isTrusted) onMove(item.id, -1);
            }}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${item.label} down`}
            disabled={index === items.length - 1}
            onClick={(event) => {
              if (event.isTrusted) onMove(item.id, 1);
            }}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Edit ${item.label}`}
            onClick={(event) => {
              if (event.isTrusted) onEdit(item.id, 'edit');
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Delete ${item.label}`}
            onClick={(event) => {
              if (event.isTrusted) {
                const next = (items[index + 1] ?? items[index - 1])?.id;
                if (onDelete(item.id)) deleted.current = { id: item.id, next };
              }
            }}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
