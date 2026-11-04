import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { XIcon } from 'lucide-react';
import { assignRefs } from './utils.js';
import {
  Combobox,
  type ComboboxProps,
  type SelectionOption,
  type SelectionEvent,
} from './combobox.js';

export interface SelectionItem {
  id: string;
  label: string;
  removeLabel: string;
  disabled?: boolean;
}

export interface ChipProps {
  item: SelectionItem;
  onRemove(item: SelectionItem, event: MouseEvent<HTMLButtonElement>): void;
  readOnly?: boolean;
  busy?: boolean;
  stateLabel?: string;
  removeRef?(node: HTMLButtonElement | null): void;
}
export function Chip({ item, onRemove, readOnly, busy, stateLabel, removeRef }: ChipProps) {
  if ((readOnly || busy || item.disabled) && !stateLabel)
    throw new Error('Blocked chip requires a visible stateLabel');
  const reason = useId();
  const blocked = readOnly || busy || item.disabled;
  return (
    // A small pill that owns its size (#5821 A5c): chip-height, no edge, and a round remove control
    // inside it. It reads no Button or host action sizes, and its dimensions are important, so neither
    // a host's variables nor its descendant control rules (`.host button { height }`) can grow it.
    <span
      data-slot="chip"
      className="tmt:box-border tmt:inline-flex tmt:h-(--tmt-foundation-chip-height)! tmt:min-h-0! tmt:max-w-full tmt:items-center tmt:gap-0.5 tmt:rounded-pill tmt:bg-secondary tmt:ps-2 tmt:pe-0.5 tmt:align-middle tmt:font-body tmt:text-(length:--tmt-foundation-caption-size) tmt:leading-none tmt:text-secondary-foreground"
    >
      <span className="tmt:min-w-0 tmt:truncate">{item.label}</span>
      {stateLabel && (
        <span id={reason} className="tmt:pe-1 tmt:text-muted-foreground">
          {stateLabel}
        </span>
      )}
      <button
        ref={removeRef}
        type="button"
        data-slot="chip-remove"
        aria-label={item.removeLabel}
        aria-describedby={stateLabel ? reason : undefined}
        aria-disabled={blocked || undefined}
        aria-busy={busy || undefined}
        disabled={item.disabled || busy}
        className="tmt:m-0! tmt:box-border tmt:inline-grid tmt:size-[calc(var(--tmt-foundation-chip-height)-4px)]! tmt:min-h-0! tmt:min-w-0! tmt:flex-none tmt:cursor-pointer tmt:appearance-none tmt:place-items-center tmt:rounded-pill tmt:border-0 tmt:bg-transparent tmt:p-0! tmt:text-inherit tmt:hover:bg-accent tmt:focus-visible:outline-solid tmt:focus-visible:outline-(length:--tmt-foundation-focus-width) tmt:focus-visible:outline-ring tmt:focus-visible:-outline-offset-(length:--tmt-foundation-focus-width) tmt:disabled:cursor-default tmt:disabled:opacity-50 tmt:[&_svg]:size-3"
        onClickCapture={(event) => {
          if (readOnly) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onKeyDownCapture={(event) => {
          if (readOnly && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
        onClick={(event) => {
          if (!blocked && event.nativeEvent.isTrusted && !event.defaultPrevented)
            onRemove(item, event);
        }}
      >
        <XIcon aria-hidden="true" />
      </button>
    </span>
  );
}
export interface ChipsProps extends Omit<
  ComboboxProps,
  'value' | 'onSelect' | 'outsidePress' | 'commitOnTab' | 'onEmptyBackspace'
> {
  items: readonly SelectionItem[];
  onAdd(option: SelectionOption, event: SelectionEvent): void;
  onRemove(
    item: SelectionItem,
    event: KeyboardEvent<HTMLInputElement> | MouseEvent<HTMLButtonElement>,
  ): void;
}
/** Host supplies caps through eligible options/state; no recipient/parser/domain state is inferred. */
export function Chips({
  items,
  onAdd,
  onRemove,
  disabled,
  readOnly,
  busy,
  stateLabel,
  inputRef,
  ...props
}: ChipsProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const removalFocus = useRef<{ removed: string; after?: string; before?: string } | null>(null);
  const open = props.controller.open;
  const focusFallback = props.focusFallback;
  useEffect(() => {
    if (!open) return;
    const field = input.current;
    const view = field?.ownerDocument.defaultView;
    const viewport = view?.visualViewport;
    if (!field || !view || !viewport) return;
    let pendingFrame: number | undefined;
    const queueReveal = () => {
      if (pendingFrame !== undefined) view.cancelAnimationFrame(pendingFrame);
      pendingFrame = view.requestAnimationFrame(() => {
        pendingFrame = undefined;
        if (!field.isConnected || field.ownerDocument.activeElement !== field) return;
        const rect = field.getBoundingClientRect();
        if (
          rect.left < viewport.offsetLeft ||
          rect.top < viewport.offsetTop ||
          rect.right > viewport.offsetLeft + viewport.width ||
          rect.bottom > viewport.offsetTop + viewport.height
        )
          field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    };
    viewport.addEventListener('resize', queueReveal);
    return () => {
      viewport.removeEventListener('resize', queueReveal);
      if (pendingFrame !== undefined) view.cancelAnimationFrame(pendingFrame);
    };
  }, [open]);
  useLayoutEffect(() => {
    const pending = removalFocus.current;
    if (!pending || items.some((item) => item.id === pending.removed)) return;
    removalFocus.current = null;
    // A successor the same host update disabled or hid does not end the search;
    // the host fallback is asked only when no earlier candidate took focus.
    for (const candidate of [
      () => (pending.after ? controls.current.get(pending.after) : undefined),
      () => (pending.before ? controls.current.get(pending.before) : undefined),
      () => input.current,
      () => focusFallback?.(),
    ]) {
      const target = candidate();
      if (!target?.isConnected || target.matches(':disabled') || target.closest('[inert]'))
        continue;
      target.focus();
      if (target.ownerDocument.activeElement === target) return;
    }
  }, [items, focusFallback]);
  function remove(
    item: SelectionItem,
    event: KeyboardEvent<HTMLInputElement> | MouseEvent<HTMLButtonElement>,
  ) {
    if (
      disabled ||
      readOnly ||
      busy ||
      item.disabled ||
      event.defaultPrevented ||
      !event.nativeEvent.isTrusted
    )
      return;
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const next = items.slice(index + 1).find((candidate) => !candidate.disabled);
    const previous = items
      .slice(0, index)
      .reverse()
      .find((candidate) => !candidate.disabled);
    removalFocus.current = { removed: item.id, after: next?.id, before: previous?.id };
    event.preventDefault();
    event.stopPropagation();
    onRemove(item, event);
  }
  return (
    <div data-slot="chips" className="tmt:grid tmt:min-w-0 tmt:gap-2">
      <div aria-label={`${props.label} selected`} className="tmt:flex tmt:flex-wrap tmt:gap-1">
        {items.map((item) => (
          <Chip
            key={item.id}
            item={item}
            readOnly={readOnly || disabled}
            busy={busy}
            stateLabel={item.disabled || readOnly || disabled || busy ? stateLabel : undefined}
            removeRef={(node) => {
              if (node) controls.current.set(item.id, node);
              else controls.current.delete(item.id);
            }}
            onRemove={remove}
          />
        ))}
      </div>
      <Combobox
        {...props}
        disabled={disabled}
        readOnly={readOnly}
        busy={busy}
        stateLabel={stateLabel}
        inputRef={(node) => assignRefs(node, input, inputRef)}
        outsidePress="dismiss-only"
        commitOnTab={false}
        onSelect={onAdd}
        onEmptyBackspace={(event) => {
          const last = [...items].reverse().find((item) => !item.disabled);
          if (last) remove(last, event);
        }}
      />
    </div>
  );
}
