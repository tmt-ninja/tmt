/** How long a page frame's download requests are ignored after the reader cancels the bar (#6094). */
export const DOWNLOAD_COOLDOWN_MS = 3000;

/**
 * The cool-down after a Cancel: a frame that asks again at once is ignored, so page script cannot
 * keep reopening the bar. Requests during it neither restart nor extend it, so a page cannot hold
 * the bar shut, and a new render or page clears it.
 */
export function downloadCooldown(now: () => number = () => performance.now()) {
  let until = -Infinity;
  return {
    /** Whether a frame request may open the bar now. */
    admits: () => now() >= until,
    /** The reader cancelled: start the cool-down. */
    cancelled: () => {
      until = now() + DOWNLOAD_COOLDOWN_MS;
    },
    /** A new render or page: frame requests open the bar again at once. */
    clear: () => {
      until = -Infinity;
    },
  };
}
