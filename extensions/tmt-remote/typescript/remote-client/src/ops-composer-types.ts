/** The Ops message box's options and handle (#5704), apart from its React module, so the plain
 * DOM pages can name it without type-checking React. */
export interface ComposerOptions {
  /** One draft per channel or DM: a new key starts that place's own draft. */
  key: string;
  label: string;
  placeholder: string;
  hint: string;
  /** The id of the visible sentence about sending: why it is unavailable, or its progress. */
  describedBy: string;
  /** Send is offered only when the host can send; otherwise it shows disabled. */
  canSend: boolean;
  /** A send is in flight: the box keeps its words and takes no edits until the host settles it. */
  busy: boolean;
  /** Changing this empties the current draft, after the host accepted it. */
  cleared: number;
  /** Enter or Send with a nonblank draft. */
  onSend?(message: string): void;
  /** The place's unsent words from before a reload, shown until the box holds its own. */
  saved?: string | undefined;
  /** The unsent words of the place `key`, each time they change; blank when it holds none. */
  onDraft?(key: string, text: string): void;
}
export interface ComposerHandle {
  update(options: ComposerOptions): void;
  unmount(): void;
}
