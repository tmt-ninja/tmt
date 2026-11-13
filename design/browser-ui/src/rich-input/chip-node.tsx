import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { X } from 'lucide-react';
import {
  $getNodeByKey,
  DecoratorNode,
  HISTORY_PUSH_TAG,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';

/** What a host keeps on a chip beyond its text, such as the identity a mention routes to. */
export type RichInputChipData = Readonly<Record<string, unknown>>;
type SerializedChip = Spread<
  { kind: string; text: string; data?: RichInputChipData },
  SerializedLexicalNode
>;

/** How the host names a chip's remove action, for example "Remove project design". */
export const ChipRemoveLabel = createContext<(kind: string, text: string) => string>(
  (_, text) => `Remove ${text}`,
);

/** What a host chip view gets: the chip, and the one way to remove it from the input. */
export interface RichInputChipViewProps {
  kind: string;
  text: string;
  data?: RichInputChipData;
  /** Removes the chip as one undo step, keeps the caret where it was and refocuses the input. */
  remove(): void;
}
/** A host's own chip look (Colab's agent chip, the page list's filter chip); the default otherwise. */
export const RichInputChipView = createContext<
  ((chip: RichInputChipViewProps) => ReactNode) | undefined
>(undefined);

/**
 * A chip inside the rich input: a mention or a filter token. Its text content is the token text
 * (`@sample-1`, `project:design`), so the document model reads it back as a range. Backspace after it
 * removes it at once, as its own remove button does.
 */
export class RichInputChipNode extends DecoratorNode<ReactNode> {
  __kind: string;
  __text: string;
  __data: RichInputChipData | undefined;
  static getType() {
    return 'tmt-rich-input-chip';
  }
  static clone(node: RichInputChipNode) {
    return new RichInputChipNode(node.__kind, node.__text, node.__data, node.__key);
  }
  constructor(kind: string, text: string, data?: RichInputChipData, key?: NodeKey) {
    super(key);
    this.__kind = kind;
    this.__text = text;
    this.__data = data;
  }
  static importJSON(serialized: SerializedChip) {
    return new RichInputChipNode(serialized.kind, serialized.text, serialized.data).updateFromJSON(
      serialized,
    );
  }
  exportJSON(): SerializedChip {
    return {
      ...super.exportJSON(),
      type: 'tmt-rich-input-chip',
      kind: this.__kind,
      text: this.__text,
      ...(this.__data ? { data: this.__data } : {}),
    };
  }
  createDOM() {
    const node = document.createElement('span');
    node.className = 'tmt-rich-input-chip-host';
    return node;
  }
  updateDOM() {
    return false;
  }
  exportDOM() {
    return { element: document.createTextNode(this.getTextContent()) };
  }
  isInline() {
    return true;
  }
  // Backspace and Delete remove the chip in one press instead of first selecting it.
  isKeyboardSelectable() {
    return false;
  }
  getTextContent() {
    return this.__text;
  }
  getKind() {
    return this.__kind;
  }
  getData() {
    return this.__data;
  }
  decorate() {
    return createElement(RichInputChip, {
      nodeKey: this.getKey(),
      kind: this.__kind,
      text: this.__text,
      data: this.__data,
    });
  }
}

export const $isRichInputChip = (node: LexicalNode | null | undefined): node is RichInputChipNode =>
  node instanceof RichInputChipNode;

function RichInputChip({
  nodeKey,
  kind,
  text,
  data,
}: {
  nodeKey: NodeKey;
  kind: string;
  text: string;
  data?: RichInputChipData;
}) {
  const [editor] = useLexicalComposerContext();
  const removeLabel = useContext(ChipRemoveLabel);
  const view = useContext(RichInputChipView);
  const remove = () => {
    if (!editor.isEditable()) return;
    editor.update(
      () => {
        const node = $getNodeByKey(nodeKey);
        if (!node) return;
        node.selectPrevious();
        node.remove();
      },
      { tag: HISTORY_PUSH_TAG, discrete: true },
    );
    editor.focus();
  };
  if (view) return view({ kind, text, data, remove });
  return (
    <span className="tmt-rich-input-chip" data-kind={kind} contentEditable={false}>
      <span className="tmt-rich-input-chip-text">{text}</span>
      <button
        type="button"
        className="tmt-rich-input-chip-remove"
        aria-label={removeLabel(kind, text)}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDownCapture={(event) => {
          if (!event.nativeEvent.isTrusted || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          event.stopPropagation();
          remove();
        }}
        onClick={(event) => {
          if (event.nativeEvent.isTrusted) remove();
        }}
      >
        <X aria-hidden="true" />
      </button>
    </span>
  );
}
