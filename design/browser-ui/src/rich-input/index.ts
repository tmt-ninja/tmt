// The rich input's own entry (#5821 A4): Lexical loads only where a page imports this.
export { RichInput, emptyRichInputValue } from './rich-input.js';
export type {
  RichInputChip,
  RichInputOption,
  RichInputProps,
  RichInputSuggestion,
  RichInputValue,
} from './rich-input.js';
export { RichInputChipNode } from './chip-node.js';
// The plain document model every rich input edits: text with one LF between paragraphs, and caller
// tokens as UTF-16 ranges over it. Hosts that add their own token nodes use these helpers.
export {
  $emptyRichInput,
  $replaceRichInput,
  $richInputCaret,
  $richInputSelection,
  $richInputText,
  $richInputTokens,
  $selectRichInputRange,
} from './document.js';
export type { RichInputRange, RichInputToken } from './document.js';
