/** A Radix keyboard selection produces a synthetic click in the same key event. */
export function trustedActivation(click: Event, key?: Event): boolean {
  return click.isTrusted || key?.isTrusted === true;
}
