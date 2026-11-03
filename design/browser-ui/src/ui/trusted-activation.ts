/** A Radix keyboard selection produces a synthetic click in the same key event. */
export function trustedActivation(click: Event, key?: Event): boolean {
  return click.isTrusted || key?.isTrusted === true;
}

/** Run the caller first; the gate still sees a prevented event and clears its own state. */
export function composeTrustedHandler<E>(
  caller: ((event: E) => void) | undefined,
  gate: (event: E) => void,
) {
  return (event: E) => {
    caller?.(event);
    gate(event);
  };
}
