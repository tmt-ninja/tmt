import { useRef, type ComponentProps, type KeyboardEvent, type MouseEvent } from 'react';
import { DropdownMenuCheckboxItem, DropdownMenuItem } from './dropdown-menu.js';
import { composeTrustedHandler, trustedActivation } from './trusted-activation.js';

/** Radix turns a keyboard selection into a synthetic click; admit it only in the trusted key turn. */
function useTrustedMenuActivation() {
  const key = useRef<Event | undefined>(undefined);
  return {
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (
        !event.defaultPrevented &&
        event.nativeEvent.isTrusted &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        const origin = event.nativeEvent;
        key.current = origin;
        queueMicrotask(() => {
          if (key.current === origin) key.current = undefined;
        });
      }
    },
    onClick(event: MouseEvent<HTMLElement>) {
      if (!trustedActivation(event.nativeEvent, key.current)) event.preventDefault();
      key.current = undefined;
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
