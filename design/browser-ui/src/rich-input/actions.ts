import type { RichInputOption, RichInputValue } from './rich-input.js';

/** Report an actual removed chip; a moved chip is still the same input value. */
export function notifyChipRemoval(
  before: RichInputValue,
  after: RichInputValue,
  notify?: (value: RichInputValue) => void,
) {
  if (!notify) return;
  const remaining = after.chips.map((chip) => `${chip.kind}\0${chip.text}`);
  const removed = before.chips.some((chip) => {
    const index = remaining.indexOf(`${chip.kind}\0${chip.text}`);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
  if (removed) notify(after);
}

/** An optional host action consumes the suggestion only when it returns true. */
export function chooseSuggestion(
  choose: ((kind: string, option: RichInputOption, value: RichInputValue) => boolean) | undefined,
  kind: string,
  option: RichInputOption,
  value: RichInputValue,
): boolean {
  return choose?.(kind, option, value) === true;
}
