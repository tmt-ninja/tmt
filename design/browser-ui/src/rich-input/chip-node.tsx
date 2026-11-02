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

type SerializedChip = Spread<{ kind: string; text: string }, SerializedLexicalNode>;

/** How the host names a chip's remove action, for example "Remove project design". */
export const ChipRemoveLabel = createContext<(kind: string, text: string) => string>(
  (_, text) => `Remove ${text}`,
);

/**
 * A chip inside the rich input: a mention or a filter token. Its text content is the token text
 * (`@sample-1`, `project:design`), so the document model reads it back as a range. Backspace after it
 * removes it at once, as its own remove button does.
 */
export class RichInputChipNode extends DecoratorNode<ReactNode> {
  __kind: string;
  __text: string;
  static getType() {
    return 'tmt-rich-input-chip';
  }
  static clone(node: RichInputChipNode) {
    return new RichInputChipNode(node.__kind, node.__text, node.__key);
  }
  constructor(kind: string, text: string, key?: NodeKey) {
    super(key);
    this.__kind = kind;
    this.__text = text;
  }
  static importJSON(serialized: SerializedChip) {
    return new RichInputChipNode(serialized.kind, serialized.text).updateFromJSON(serialized);
  }
  exportJSON(): SerializedChip {
    return {
      ...super.exportJSON(),
      type: 'tmt-rich-input-chip',
      kind: this.__kind,
      text: this.__text,
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
  decorate() {
    return createElement(RichInputChip, {
      nodeKey: this.getKey(),
      kind: this.__kind,
      text: this.__text,
    });
  }
}

export const $isRichInputChip = (node: LexicalNode | null | undefined): node is RichInputChipNode =>
  node instanceof RichInputChipNode;

function RichInputChip({ nodeKey, kind, text }: { nodeKey: NodeKey; kind: string; text: string }) {
  const [editor] = useLexicalComposerContext();
  const removeLabel = useContext(ChipRemoveLabel);
  return (
    <span className="tmt-rich-input-chip" data-kind={kind} contentEditable={false}>
      <span className="tmt-rich-input-chip-text">{text}</span>
      <button
        type="button"
        className="tmt-rich-input-chip-remove"
        aria-label={removeLabel(kind, text)}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (!event.nativeEvent.isTrusted || !editor.isEditable()) return;
          editor.update(
            () => {
              const node = $getNodeByKey(nodeKey);
              if (!node) return;
              node.selectPrevious();
              node.remove();
            },
            { tag: HISTORY_PUSH_TAG, discrete: true },
          );
        }}
      >
        <X aria-hidden="true" />
      </button>
    </span>
  );
}
