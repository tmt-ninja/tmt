/**
 * Whether Colab's page is out of sight: the document is hidden, or the TMT web app keeps Colab
 * suspended while another route shows (#5954). Work that pauses for a hidden document (polling,
 * observation, reading reports) reads this, and listens through these helpers, so a kept Colab is
 * as quiet as a background tab.
 */
let suspended = false;
const changes = new EventTarget();

export function pageHidden(): boolean {
  return suspended || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
}

/** The shell suspended or resumed Colab: visibility listeners hear it as a visibility change. */
export function setSuspended(next: boolean): void {
  if (suspended === next) return;
  suspended = next;
  changes.dispatchEvent(new Event('visibilitychange'));
}

export function addVisibilityListener(listener: () => void): void {
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', listener);
  changes.addEventListener('visibilitychange', listener);
}

export function removeVisibilityListener(listener: () => void): void {
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', listener);
  changes.removeEventListener('visibilitychange', listener);
}
