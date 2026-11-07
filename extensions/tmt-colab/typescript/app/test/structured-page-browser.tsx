import '@tmt/browser-ui/static.css';
import '../src/style.css';
import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BlockOp, BlockRecord } from '../src/block-model.js';
import type { Mark } from '../src/blocks.js';
import { applyOps } from '../src/block-apply.js';
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
    id: 'e',
    type: 'paragraph',
    parent: 'root',
    pos: 'g',
    props: {},
    text: '',
    deleted: false,
  },
  {
    id: 't',
    type: 'todo',
    parent: 'root',
    pos: 'k',
    props: { checked: false },
    text: 'Review',
    deleted: false,
  },
];

/** The 838644c2 spec-page mockup ("整頁：spec 頁") as blocks, with a long paragraph added so the
 * trial captures show filled states: a card holding a paragraph, headings, a table with rows, a list
 * and two callouts. */
const SPEC_PAGE: BlockRecord[] = (() => {
  let at = 0;
  const pos = () => String.fromCharCode(66 + at++);
  const block = (
    id: string,
    type: BlockRecord['type'],
    text: string | undefined,
    props: Record<string, unknown> = {},
    parent = 'root',
  ): BlockRecord => ({
    id,
    type,
    parent,
    pos: pos(),
    props,
    ...(text !== undefined && { text }),
    deleted: false,
  });
  /** `text` with `marks` on the passages they name: [passage, mark, value?]. */
  const marked = (
    record: BlockRecord,
    ...marks: [string, Mark['mark'], string?][]
  ): BlockRecord => {
    const chars = [...record.text!];
    return {
      ...record,
      marks: marks
        .map(([find, mark, value]) => {
          const from = [...record.text!.slice(0, record.text!.indexOf(find))].length;
          return { from, to: from + [...find].length, mark, ...(value && { value }) };
        })
        .filter((run) => run.to <= chars.length)
        .sort((a, b) => a.from - b.from || a.to - b.to),
    };
  };
  const row = (id: string, name: string, use: string): BlockRecord => ({
    ...block(id, 'row', undefined, {}, 'table'),
    cells: { name, use },
  });
  return [
    block('card', 'card', undefined, { title: '一句話' }),
    block(
      'card-p',
      'paragraph',
      '新的 Colab 頁面類型：頁面由一個個有類型的區塊組成，長相由區塊決定。只改 Colab 的內容區；頁面標題在共用的 GUI header。',
      {},
      'card',
    ),
    block('kinds', 'heading', '區塊種類', { level: 2 }),
    marked(
      block('first', 'paragraph', '第一批 13 種區塊。Colab 頁面本身就是 ticket，見 spec 頁。'),
      ['第一批', 'bold'],
      ['13', 'code'],
      ['ticket', 'italic'],
      ['spec 頁', 'link', 'https://example.com/spec'],
    ),
    // A script link is not admitted, so it draws as plain text.
    marked(
      block('unsafe', 'paragraph', '這個連結不會打開。'),
      ['連結', 'link', 'javascript:alert(1)'],
    ),
    marked(
      block(
        'long',
        'paragraph',
      '每個區塊只有一種長相，由設計系統決定；頁面不帶自己的樣式。同一時間只有被點到的那一塊是編輯器，其他區塊都是靜態內容，所以長頁面也不會變慢。你打字時 agent 也可以改同一塊：你的字先留在頁面上，agent 的修改在你停下來時合進來，游標留在你打字的地方。兩邊改到同一段文字時，兩邊的字都保留，頁面的字排在前面。',
      ),
      ['只有一種長相', 'bold'],
      ['被點到的那一塊', 'italic'],
      ['agent', 'code'],
    ),
    block('table', 'table', undefined, {
      label: '區塊',
      columns: [
        { id: 'name', name: '區塊' },
        { id: 'use', name: '用途' },
      ],
    }),
    row('r1', '小標題', '## 和 ###'),
    row('r2', '段落', '一般文字'),
    row('r3', '卡片／區段', '唯一能放其他區塊的區塊'),
    block('look', 'heading', '文件的樣子', { level: 2 }),
    block('l1', 'list', '區塊之間沒有框線，只有卡片畫框。'),
    block('l2', 'list', '滑過或選取是淡色底。'),
    block('l3', 'list', '整個編輯器一個把手，滑過或鍵盤焦點時才出現。'),
    block('order', 'callout', '#5980 DsScope → #5981 元件 → 區塊資料和 agent 指令 → 編輯器。', {
      tone: 'working',
      label: '做的順序',
    }),
    block('agent', 'callout', 'tmt colab block insert PAGE --type table --after b-12 --json', {
      tone: 'waiting',
      label: '等你',
      heading: 'agent 怎麼改',
    }),
  ];
})();

declare global {
  interface Window {
    /** The scripted agent: one exact replacement in a block's text, as `block text --find`. */
    agentReplace(id: string, find: string, replacement: string): void;
    /** The serve's text for a block now. */
    serveText(id: string): string | undefined;
    /** Ops the page sent, in order. */
    sent: BlockOp[];
    /** Links the page asked to open, in order. */
    opened: { href: string; newTab: boolean }[];
    /** Hold the serve's commits (true) or let the held ones through (false). */
    holdServe(hold: boolean): void;
  }
}

/** A structured page over an in-memory serve, with a scripted agent writing the same blocks: the
 * serve applies a batch with `applyOps`, the editor's one model of the serve's apply. */
export function mount(content: 'plan' | 'spec' = 'plan') {
  document.getElementById('root')?.setAttribute('hidden', '');
  const host = document.createElement('main');
  host.id = 'structured-page-fixture';
  host.style.cssText = 'max-width:720px;margin:24px auto;padding:12px';
  document.body.append(host);
  let blocks = content === 'spec' ? SPEC_PAGE : start;
  // Each change is a new view with the next local order, as `PageView.seq` gives it.
  let seq = 1;
  const listeners = new Set<(next: { records: BlockRecord[]; seq: number }) => void>();
  const publish = (next: BlockRecord[]) => {
    blocks = next;
    seq++;
    for (const listener of listeners) listener({ records: next, seq });
    return seq;
  };
  const write = (id: string, text: string) =>
    publish(blocks.map((block) => (block.id === id ? { ...block, text } : block)));
  window.sent = [];
  window.opened = [];
  window.serveText = (id) => blocks.find((block) => block.id === id)?.text;
  window.agentReplace = (id, find, replacement) => {
    const text = window.serveText(id)!;
    if (!text.includes(find)) throw new Error(`${find} is not in ${id}`);
    write(id, text.replace(find, replacement));
  };
  let holding = false;
  const held: (() => void)[] = [];
  window.holdServe = (hold) => {
    holding = hold;
    if (!hold) for (const commit of held.splice(0)) commit();
  };
  const send = (ops: BlockOp[]) =>
    new Promise<number>((resolve) => {
      window.sent.push(...ops);
      const later = (commit: () => void) =>
        setTimeout(() => (holding ? held.push(commit) : commit()), SERVE_MS);
      later(() => {
        // One batch commits as one change, as the serve's does; one it would refuse changes
        // nothing.
        let next = blocks;
        try {
          next = applyOps(blocks, ops);
        } catch {
          // Refused.
        }
        resolve(publish(next));
      });
    });
  function Page() {
    const [view, setView] = useState({ records: blocks, seq });
    const subscribe = useCallback((node: HTMLElement | null) => {
      if (node) listeners.add(setView);
      else listeners.delete(setView);
    }, []);
    const {
      tree,
      editing,
      focus,
      typed,
      key,
      pasteUrl,
      menu,
      pick,
      hover,
      closeMenu,
      selected,
      selectionFocus,
      pageKey,
      toast,
      undo,
      blockMenu,
      act,
      move,
      openBlockMenu,
      insertAfter,
      closeBlockMenu,
      hoverBlockMenu,
    } = useBlockEditing(view.records, send, view.seq);
    return (
      <section ref={subscribe}>
        <StructuredPage
          tree={tree}
          editing={editing}
          onFocus={focus}
          onTyped={typed}
          onKey={key}
          onPasteUrl={pasteUrl}
          onLink={(href, newTab) => window.opened.push({ href, newTab })}
          menu={menu}
          onPick={(entry) => void pick(entry)}
          onHover={hover}
          onCloseMenu={closeMenu}
          selected={selected}
          selectionFocus={selectionFocus}
          onPageKey={pageKey}
          toast={toast}
          onUndo={undo}
          blockMenu={blockMenu}
          onAction={act}
          onHoverAction={hoverBlockMenu}
          onCloseBlockMenu={closeBlockMenu}
          onOpenBlockMenu={openBlockMenu}
          onInsertAfter={insertAfter}
          onMove={move}
        />
      </section>
    );
  }
  createRoot(host).render(<Page />);
}
