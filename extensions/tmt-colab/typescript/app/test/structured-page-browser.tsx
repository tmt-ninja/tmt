import '@tmt/browser-ui/static.css';
import '../src/style.css';
import { textMerge } from '@tmt/colab-client';
import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BlockOp, BlockRecord } from '../src/block-model.js';
import { StructuredPage } from '../src/structured-page.js';
import { useBlockEditing } from '../src/use-block-editing.js';

/** How long the fixture's serve takes to commit an op and show it on the page. */
const SERVE_MS = 120;

const start: BlockRecord[] = [
  {
    id: 'h',
    type: 'heading',
    parent: 'root',
    pos: 'F',
    props: { level: 2 },
    text: 'Plan',
    deleted: false,
  },
  {
    id: 'p',
    type: 'paragraph',
    parent: 'root',
    pos: 'V',
    props: {},
    text: 'Ship the stack.',
    deleted: false,
  },
  {
    id: 't',
    type: 'todo',
    parent: 'root',
    pos: 'k',
    props: { done: false },
    text: 'Review',
    deleted: false,
  },
];

declare global {
  interface Window {
    /** The scripted agent: one exact replacement in a block's text, as `block text --find`. */
    agentReplace(id: string, find: string, replacement: string): void;
    /** The serve's text for a block now. */
    serveText(id: string): string | undefined;
    /** Ops the page sent, in order. */
    sent: BlockOp[];
  }
}

/** A structured page over an in-memory serve, with a scripted agent writing the same blocks: the
 * serve applies a whole-text op with `textMerge.merge`, as the native one does. */
export function mount() {
  document.getElementById('root')?.setAttribute('hidden', '');
  const host = document.createElement('main');
  host.id = 'structured-page-fixture';
  host.style.cssText = 'max-width:720px;margin:24px auto;padding:12px';
  document.body.append(host);
  let blocks = start;
  const listeners = new Set<(next: BlockRecord[]) => void>();
  const publish = (next: BlockRecord[]) => {
    blocks = next;
    for (const listener of listeners) listener(next);
  };
  const write = (id: string, text: string) =>
    publish(blocks.map((block) => (block.id === id ? { ...block, text } : block)));
  window.sent = [];
  window.serveText = (id) => blocks.find((block) => block.id === id)?.text;
  window.agentReplace = (id, find, replacement) => {
    const text = window.serveText(id)!;
    if (!text.includes(find)) throw new Error(`${find} is not in ${id}`);
    write(id, text.replace(find, replacement));
  };
  const send = (ops: BlockOp[]) =>
    new Promise<void>((resolve) => {
      window.sent.push(...ops);
      setTimeout(() => {
        for (const op of ops)
          if (op.op === 'text' && 'set' in op)
            write(op.id, textMerge.merge(op.base, window.serveText(op.id)!, op.set).text);
        resolve();
      }, SERVE_MS);
    });
  function Page() {
    const [records, setRecords] = useState(blocks);
    const subscribe = useCallback((node: HTMLElement | null) => {
      if (node) listeners.add(setRecords);
      else listeners.delete(setRecords);
    }, []);
    const { tree, editing, focus, typed } = useBlockEditing(records, send);
    return (
      <section ref={subscribe}>
        <StructuredPage tree={tree} editing={editing} onFocus={focus} onTyped={typed} />
      </section>
    );
  }
  createRoot(host).render(<Page />);
}
