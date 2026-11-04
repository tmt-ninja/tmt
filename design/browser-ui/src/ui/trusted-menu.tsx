import { useRef, type ComponentProps, type KeyboardEvent, type MouseEvent } from 'react';
import { DropdownMenuCheckboxItem, DropdownMenuItem } from './dropdown-menu.js';
import { composeTrustedHandler, keyTurn } from '../trusted-activation.js';

/** Radix turns a keyboard selection into a synthetic click; admit it only in the trusted key turn. */
function useTrustedMenuActivation() {
  const turn = useRef<ReturnType<typeof keyTurn>>(undefined);
  turn.current ??= keyTurn('microtask');
  const key = turn.current;
  return {
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key === 'Enter' || event.key === ' ') key.record(event.nativeEvent);
    },
    onClick(event: MouseEvent<HTMLElement>) {
      if (!key.admit(event.nativeEvent)) event.preventDefault();
      key.clear();
    },
  };
}

export function TrustedMenuItem({
  onClick,
  onKeyDown,
  ...props
}: ComponentProps<typeof DropdownMenuItem>) {
  const gate = useTrustedMenuActivation();
  return (
    <DropdownMenuItem
      {...props}
      onClick={composeTrustedHandler(onClick, gate.onClick)}
      onKeyDown={composeTrustedHandler(onKeyDown, gate.onKeyDown)}
    />
  );
}
export function TrustedMenuCheckboxItem({
  onClick,
  onKeyDown,
  ...props
}: ComponentProps<typeof DropdownMenuCheckboxItem>) {
  const gate = useTrustedMenuActivation();
  return (
    <DropdownMenuCheckboxItem
      {...props}
      onClick={composeTrustedHandler(onClick, gate.onClick)}
      onKeyDown={composeTrustedHandler(onKeyDown, gate.onKeyDown)}
    />
  );
}
