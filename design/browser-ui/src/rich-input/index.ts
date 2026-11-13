// The rich input's own entry (#5821 A4): Lexical loads only where a page imports this.
export { RichInput, emptyRichInputValue } from './rich-input.js';
export type {
  RichInputChip,
  RichInputOption,
  RichInputProps,
  RichInputSuggestion,
  RichInputValue,
} from './rich-input.js';
export { $isRichInputChip, RichInputChipNode, RichInputChipView } from './chip-node.js';
export type { RichInputChipViewProps } from './chip-node.js';
// The core (#5830): the editing lifetime and editable surface hosts build their own inputs on.
export { RICH_INPUT_RESET_TAG, RichInputControl, RichInputCore } from './core.js';
export type { RichInputDocument, RichInputEdit } from './core.js';
// The plain document model every rich input edits: text with one LF between paragraphs, and caller
// tokens as UTF-16 ranges over it. Hosts that add their own token nodes use these helpers.
export {
  $replaceRichInput,
  $richInputCaret,
  $richInputSelection,
  $richInputText,
  $richInputTokens,
  $selectRichInputRange,
} from './document.js';
export type { RichInputRange } from './document.js';
