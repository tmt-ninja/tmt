/** A Radix keyboard selection produces a synthetic click in the same key event. */
export function trustedActivation(click: Event, key?: Event): boolean {
  return click.isTrusted || key?.isTrusted === true;
}

/**
 * A one-shot trusted key turn: the Enter or Space that will be followed by a click on the same
 * element. The caller records the key events it accepts; a click is admitted when it is trusted
 * itself or lands inside the element that took the recorded key. The turn expires on its own:
 * - `microtask` suits a React handler, where the synthetic click follows in the same key event.
 * - `task` suits plain DOM listeners: the browser runs a microtask checkpoint between native
 *   listeners of one key, so the turn must last until the next task.
 */
export function keyTurn(expiry: 'microtask' | 'task') {
  let current: Event | undefined;
  return {
    record(event: Event) {
      if (event.defaultPrevented || !event.isTrusted) return;
      current = event;
      const expire = () => {
        if (current === event) current = undefined;
      };
      if (expiry === 'task') setTimeout(expire, 0);
      else queueMicrotask(expire);
    },
    /** Whether a click is a person's: trusted, or inside the element that took the key turn. A
     * click that is admitted uses the turn up. */
    admit(click: Event): boolean {
      const origin = current?.target;
      const target = click.target;
      const key =
        current &&
        !current.defaultPrevented &&
        origin instanceof Node &&
        target instanceof Node &&
        origin.contains(target)
          ? current
          : undefined;
      const admitted = trustedActivation(click, key);
      if (admitted) current = undefined;
      return admitted;
    },
    clear() {
      current = undefined;
    },
  };
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
