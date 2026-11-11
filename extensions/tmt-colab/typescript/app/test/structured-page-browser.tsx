import '@tmt/browser-ui/static.css';
import type { attachment } from '@tmt/colab-client';
import type { AttachmentBinding } from '../src/attachment-service.js';
import type { DocumentImageInput } from '../src/document-images.js';
import '../src/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  type BlockOp,
  type BlockRecord,
  type TableColumn,
  tableColumns,
} from '../src/block-model.js';
import type { WorkBundleSource } from '@tmt/browser-ui/blocks';
import type { Mark } from '../src/blocks.js';
import type { ThreadBinding } from '../src/thread-store.js';
import type { QuoteSelector, ThreadView } from '../src/thread-records.js';
import type { ParentPageViewSource } from '../src/parent-page-view.js';
import { applyOps } from '../src/block-apply.js';
import { BlockTree } from '../src/block-tree.js';
import { mountRenderer } from '../src/renderer.js';
import { pageDesignSystems } from '../src/design-system-pages.js';
import type { PageBinding, PageTransport, PageView } from '../src/transport.js';
import type { RegisteredQuestion } from '../src/question-registry.js';
import { destination, id as fixtureId } from './ask-fixtures.js';
import { StructuredPage } from '../src/structured-page.js';
import { resendStale, SaveOutcomeUnknown, SaveRefused } from '../src/save.js';
import { useBlockEditing } from '../src/use-block-editing.js';
import type { AttachmentInput, StoredAttachment } from '../src/attachment-service.js';
import type { BlockFiles } from '../src/block-uploads.js';
import type { MentionPages } from '../src/mention-pages.js';

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
const IMAGE_A = 'a1b2c3d4-0000-4000-8000-000000000001';
const IMAGE_B = 'b2c3d4e5-0000-4000-8000-000000000002';
/** An attachment whose read fails until `window.failImage` is cleared (Retry then reads it). */
const IMAGE_C = 'c3d4e5f6-0000-4000-8000-000000000003';
/** A PNG drawn here, as a page's attachment would read: a tinted sheet with a mark. */
async function samplePng(tint: string): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(320, 180);
  const context = canvas.getContext('2d')!;
  context.fillStyle = tint;
  context.fillRect(0, 0, 320, 180);
  context.fillStyle = '#ffffff';
  context.fillRect(24, 24, 272, 30);
  context.fillRect(24, 70, 160, 80);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}
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
          const from = Array.from(record.text!.slice(0, record.text!.indexOf(find))).length;
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
    marked(block('unsafe', 'paragraph', '這個連結不會打開。'), [
      '連結',
      'link',
      'javascript:alert(1)',
    ]),
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
    block('steps', 'heading', '做的步驟', { level: 3 }),
    block('n1', 'list', '區塊資料和 agent 指令', { style: 'number' }),
    block('n2', 'list', '驗證器和 Yjs 區塊', { style: 'number', indent: 1 }),
    block('n3', 'list', 'CLI 和批次', { style: 'number', indent: 1 }),
    block('n4', 'list', '瀏覽器編輯器', { style: 'number' }),
    block('bundle', 'work-bundle', undefined, {
      page: '6b1c0f3e-2a4d-4c8e-9f10-7a2b3c4d5e6f',
      number: 6005,
      work: '瀏覽器編輯器：一個人寫、agent 同時改',
      tickets: [{ label: '#6005', href: 'https://github.com/tmt-ninja/tmt/issues/6005' }],
    }),
    block('pages', 'page-view', undefined, {
      label: '相關頁面',
      sort: 'title',
      rows: [
        { id: 'a', name: '區塊資料模型', stage: 'Done', updated: '今天', author: 'gui-4' },
        { id: 'b', name: '瀏覽器編輯器', stage: 'Working', updated: '剛剛', author: 'gui-2' },
        { id: 'c', name: '<img src=x onerror=alert(1)>', stage: 'Review', author: 'agent' },
      ],
    }),
    block('live', 'page-view', undefined, { label: '我的頁面', groupBy: 'none' }),
    block('7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b', 'question', '先做哪個區塊？', {
      kind: 'single',
      choices: ['問題', '圖片', 'Mockup'],
    }),
    block('mock', 'mockup', undefined, {
      preset: '390',
      markup:
        '<main><h1>手機上的區塊選單</h1><p>插入、移動和刪除都在同一張表單裡。</p><tmt-ui-button>新增區塊</tmt-ui-button><script>parent.postMessage("escaped","*")</script></main>',
    }),
    // Two of the page's attachments (a short and a full reference) and an outside URL the serve
    // admits for agents, which the editor never loads.
    block('pics', 'image', undefined, {
      layout: 'grid',
      images: [
        { src: 'colab-attachment:a1b2c3d4', alt: '插入選單的草圖', caption: '插入選單' },
        { src: `colab-attachment:${IMAGE_B}`, caption: '手機上的把手' },
        { src: 'https://example.com/outside.png', alt: '外部圖片', caption: '外部網址' },
      ],
    }),
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

/** A page laid out as a night page is (#6257): a section card with its meta, the same run of blocks
 * at the root and in the card, a long paragraph, a table and consecutive questions. */
const LAYOUT_PAGE: BlockRecord[] = (() => {
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
  /** The same run of blocks under `parent`, ids prefixed. */
  const run = (prefix: string, parent: string): BlockRecord[] => [
    block(`${prefix}-p`, 'paragraph', '一段文字', {}, parent),
    block(`${prefix}-l1`, 'list', '第一項', {}, parent),
    block(`${prefix}-l2`, 'list', '第二項', {}, parent),
    block(`${prefix}-l3`, 'list', '第三項', {}, parent),
    block(`${prefix}-t1`, 'todo', '做這個', { checked: false }, parent),
    block(`${prefix}-t2`, 'todo', '再做這個', { checked: true }, parent),
    block(`${prefix}-h2`, 'heading', '下一段', { level: 2 }, parent),
    block(`${prefix}-h3`, 'heading', '小段', { level: 3 }, parent),
    block(`${prefix}-after`, 'paragraph', '標題後的文字', {}, parent),
  ];
  const question = (id: string, parent = 'root') =>
    block(
      id,
      'question',
      '先做哪一個？',
      { kind: 'single', choices: ['第一個', '第二個', '第三個'] },
      parent,
    );
  return [
    block('top', 'heading', '夜間計畫', { level: 2 }),
    block(
      'prose',
      'paragraph',
      '這一段很長，要看每一行放多少字。每個區塊只有一種長相，由設計系統決定；頁面不帶自己的樣式。同一時間只有被點到的那一塊是編輯器，其他區塊都是靜態內容，所以長頁面也不會變慢。你打字時 agent 也可以改同一塊：你的字先留在頁面上，agent 的修改在你停下來時合進來，游標留在你打字的地方。兩邊改到同一段文字時，兩邊的字都保留，頁面的字排在前面。',
    ),
    ...run('root', 'root'),
    block('sec', 'card', undefined, { variant: 'section', title: '今天', meta: '3 項未完成' }),
    ...run('in', 'sec'),
    question('sq1', 'sec'),
    question('sq2', 'sec'),
    block('plain', 'card', undefined, { title: '一般卡片' }),
    block('plain-p', 'paragraph', '卡片裡的文字', {}, 'plain'),
    block('table', 'table', undefined, {
      label: '區塊',
      columns: [
        { id: 'name', name: '區塊' },
        { id: 'use', name: '用途' },
      ],
    }),
    {
      ...block('r1', 'row', undefined, {}, 'table'),
      cells: { name: '小標題', use: '## 和 ###' },
    },
    question('q1'),
    question('q2'),
  ];
})();

declare global {
  interface Window {
    /** The scripted agent: one exact replacement in a block's text, as `block text --find`. */
    agentReplace(id: string, find: string, replacement: string): void;
    /** The serve's text for a block now. */
    serveText(id: string): string | undefined;
    /** The scripted agent: one batch of block ops, as `tmt colab block batch`. */
    agentBatch(ops: BlockOp[]): void;
    /** The serve's cells for a table's rows now, in order. */
    serveRows(table: string): { id: string; cells?: Record<string, string> }[];
    serveProps(id: string): Readonly<Record<string, unknown>> | undefined;
    /** The serve's marks on a block's text now. */
    serveMarks(id: string): readonly Mark[] | undefined;
    /** The attachments the page's authorized read opened, by ID. */
    imageReads: string[];
    /** While true, the read of `IMAGE_C` fails. */
    failImage: boolean;
    /** While set, every read waits for `releaseImages`. */
    holdImages(): void;
    releaseImages(): void;
    serveColumns(table: string): TableColumn[];
    /** Ops the page sent, in order. */
    sent: BlockOp[];
    /** Every attempt to send a batch, refused ones included, in order. */
    attempts: BlockOp[][];
    /** The serve refuses the next `times` attempts: as stale (nothing written), as a block that is
     * gone, or with its outcome in doubt. */
    refuseBatch(kind: 'stale' | 'unavailable' | 'missing' | 'unknown', times?: number): void;
    /** The answer comments this page recorded, in order. */
    answers(): { body: string; questionId?: string }[];
    /** The owner-only gate closes: the owner sources withhold from now on. */
    revokeOwner(): void;
    /** Links the page asked to open, in order. */
    opened: { href: string; newTab: boolean }[];
    /** Hold the serve's commits (true) or let the held ones through (false). */
    holdServe(hold: boolean): void;
    /** How many commits the serve holds now. */
    heldCommits(): number;
    /** The page's view of each commit reaches the editor this many ms after the commit settles
     * (the live page resolves a batch before it publishes the view that shows it, #6249). */
    delayViews(ms: number): void;
    /** What the owner device asked of the recipient seam, in order: the selector, or `null` when it
     * asked for the page creator. */
    recipientChosen: (string | null)[];
    /** The next recipient choice is refused (once). */
    refuseRecipient(): void;
    /** Files the page uploaded (#6202), in order, and the attachment IDs each batch listed. */
    uploaded: { filename: string; mediaType: string; size: number }[];
    listedFiles: string[][];
    /** While set, uploads wait for `releaseUploads`. */
    holdUploads(): void;
    releaseUploads(): void;
    /** While true, an upload fails; while true, a batch that lists files is refused. */
    failUpload: boolean;
    refuseFiles: boolean;
    /** How many files the page lists besides its images (the cap counts them). */
    extraFiles: number;
    /** The attachment IDs a file card asked to download, in order. */
    downloads: string[];
    /** Other pages the @ picker read (#6208): the list reads, each page read, and those ended
     * before they settled. */
    pageListReads: number;
    pageReads: string[];
    pageAborts: string[];
    /** While true, a page read fails. */
    failPageReads: boolean;
  }
}

/** The agents the owner's directory lists (`mount(..., { recipients: true })`). */
const RECIPIENT_AGENTS = [
  ['First reviewer', 6],
  ['Next builder', 7],
  ['An agent with a very long name that has to truncate instead of pushing the line wider', 8],
].map(([agentName, n]) => ({
  ...destination(),
  agent: fixtureId(n as number),
  agentName: agentName as string,
}));
const QUESTION_ID = '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const QUESTION_ATTRIBUTION = { writerId: '30000000-0000-4000-8000-000000000001', timeMs: 1_000 };

/** A structured page over an in-memory serve, with a scripted agent writing the same blocks: the
 * serve applies a batch with `applyOps`, the editor's one model of the serve's apply. */
export function mount(
  content: 'plan' | 'spec' | 'layout' | 'empty' | 'empty-reader' | 'empty-failure' = 'plan',
  options: {
    /** The owner device may choose a question's recipient: it holds the metadata seam and reads
     * the agent directory. */
    recipients?: boolean;
    /** The question starts with no agent of its own. */
    follows?: boolean;
  } = {},
) {
  document.getElementById('root')?.setAttribute('hidden', '');
  const host = document.createElement('main');
  host.id = 'structured-page-fixture';
  // The layout page is measured at a stage wider than its prose measure (#6257).
  host.style.cssText = `max-width:${content === 'layout' ? 1100 : 720}px;margin:24px auto;padding:12px`;
  document.body.append(host);
  let blocks =
    content === 'spec'
      ? SPEC_PAGE
      : content === 'layout'
        ? LAYOUT_PAGE
        : content.startsWith('empty')
          ? []
          : start;
  // Each change is a new view with the next local order, as `PageView.seq` gives it.
  let seq = 1;
  const listeners = new Set<(next: { records: BlockRecord[]; seq: number }) => void>();
  let viewDelay = 0;
  const publish = (next: BlockRecord[]) => {
    blocks = next;
    seq++;
    const view = { records: next, seq };
    const show = () => {
      for (const listener of listeners) listener(view);
    };
    if (viewDelay) setTimeout(show, viewDelay);
    else show();
    return seq;
  };
  window.delayViews = (ms) => {
    viewDelay = ms;
  };
  const write = (id: string, text: string) =>
    publish(blocks.map((block) => (block.id === id ? { ...block, text } : block)));
  window.sent = [];
  window.attempts = [];
  const refusals: (() => Error)[] = [];
  window.refuseBatch = (kind, times = 1) => {
    for (let i = 0; i < times; i++)
      refusals.push(() =>
        kind === 'stale'
          ? new SaveRefused('COLAB_STALE_BASE', 'Page changed since the editing base.')
          : kind === 'unavailable'
            ? new SaveRefused('COLAB_UNAVAILABLE', 'Colab could not take the change.')
            : kind === 'missing'
              ? new SaveRefused('COLAB_BLOCK_NOT_FOUND', 'That block no longer exists.')
              : new SaveOutcomeUnknown(crypto.randomUUID()),
      );
  };
  window.opened = [];
  window.recipientChosen = [];
  let refuseRecipient = false;
  window.refuseRecipient = () => {
    refuseRecipient = true;
  };
  const questionListeners = new Set<(next: RegisteredQuestion[]) => void>();
  let questions: RegisteredQuestion[] = [
    {
      id: QUESTION_ID,
      ...(options.follows
        ? {}
        : { agent: { id: '50000000-0000-4000-8000-000000000003', name: 'tmt-gui-lead' } }),
      state: 'open',
      attribution: QUESTION_ATTRIBUTION,
    },
  ];
  /** The owner device's seam, answered as the serve does: it resolves the selector to a directory
   * agent (no selector clears the entry) and the registry shows the result. */
  const ownerBinding = {
    canMetadata: () => true,
    metadataRevision: async () => 'revision-1',
    async metadata(_action: string, body: Record<string, unknown>) {
      const selector = typeof body.selector === 'string' ? body.selector : null;
      window.recipientChosen.push(selector);
      await new Promise((resolve) => setTimeout(resolve, SERVE_MS));
      if (refuseRecipient) {
        refuseRecipient = false;
        throw Object.assign(
          new Error('That identity was not found. Check the name or ID and try again.'),
          { code: 'COLAB_IDENTITY_UNKNOWN' },
        );
      }
      const found = RECIPIENT_AGENTS.find((agent) => agent.agent === selector);
      questions = questions.map(({ agent: _own, ...rest }) =>
        found ? { ...rest, agent: { id: found.agent, name: found.agentName } } : rest,
      );
      for (const listener of questionListeners) listener(questions);
    },
    ask: { destinations: async () => RECIPIENT_AGENTS },
  } as unknown as PageBinding;
  // The page's gated owner sources, as the router's are: while the page is owner-only content
  // they publish, and once revoked they withhold (the unavailable state).
  let owner = true;
  const gated = new Set<() => void>();
  window.revokeOwner = () => {
    owner = false;
    for (const fail of gated) fail();
  };
  const workSource: WorkBundleSource = {
    subscribe(_page, _signal, publish, failed) {
      if (!owner) failed();
      else
        publish({
          title: '瀏覽器區塊編輯器',
          href: '#page-6005',
          summary: '一個人寫和重排頁面，agent 同時改同一頁。',
          stage: 'Working',
          owner: 'gui-2',
          updated: '剛剛',
          projects: ['Colab'],
        });
      gated.add(failed);
      return () => gated.delete(failed);
    },
  };
  // The page's discussion: an answer is a comment on its own thread, bound to the question, which
  // the page then shows as a verified record (as the serve's discussion read does).
  let threads: ThreadView[] = [];
  const threadListeners = new Set<(next: ThreadView[]) => void>();
  window.answers = () =>
    threads.flatMap((thread) =>
      thread.comments.map(({ body, questionId }) => ({ body, ...(questionId && { questionId }) })),
    );
  const scope = { spaceId: 'a'.repeat(32), pageId: '1'.repeat(32), epoch: '1' };
  const discussion = {
    deviceId: 'device-1',
    scope,
    async create(
      body: string,
      anchor: QuoteSelector | null,
      _attach?: unknown,
      questionId?: string,
    ) {
      await new Promise((resolve) => setTimeout(resolve, SERVE_MS));
      const threadId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const ref = { writer: 'device-1', id: threadId };
      const at = String(Date.now());
      const common = {
        version: 1,
        ...scope,
        senderDevice: 'device-1',
        deviceName: 'You',
        revision: '1',
        at,
        deleted: false,
      };
      const thread = {
        ...common,
        kind: 'thread',
        threadId,
        createdAt: at,
        anchor,
        resolved: false,
        ref,
        comments: [
          {
            ...common,
            kind: 'comment',
            deviceAuthor: true,
            sequence: '1',
            thread: ref,
            body,
            messageId,
            ...(questionId && { questionId }),
            ref: { writer: 'device-1', id: messageId },
          },
        ],
      } as unknown as ThreadView;
      threads = [...threads, thread];
      for (const listener of threadListeners) listener(threads);
      return {
        thread: ref,
        threadRevision: '1',
        message: thread.comments[0]!.ref,
        messageRevision: '1',
      };
    },
  } as unknown as ThreadBinding;
  // The real sandboxed renderer, as the router's mount uses it; one function for the page's life.
  // The built-in tmt GUI system ships with the app, so it needs no page behind it.
  const designSystem = pageDesignSystems({} as PageTransport);
  // The page's attachment list and its authorized read: two PNG attachments, read by descriptor.
  window.imageReads = [];
  window.failImage = true;
  let gate: Promise<void> | undefined;
  let release = () => {};
  window.holdImages = () => {
    gate = new Promise((resolve) => (release = resolve));
  };
  window.releaseImages = () => {
    gate = undefined;
    release();
  };
  // The page's files: the three images, then any this page adds (#6202), with their bytes.
  const added = new Map<string, Uint8Array>();
  let descriptors = [IMAGE_A, IMAGE_B, IMAGE_C].map((attachmentId) => ({
    attachmentId,
    mediaType: 'image/png',
    plaintextBytes: '4000',
  })) as unknown as attachment.AttachmentDescriptor[];
  const descriptorListeners = new Set<(next: attachment.AttachmentDescriptor[]) => void>();
  window.uploaded = [];
  window.listedFiles = [];
  window.failUpload = false;
  window.refuseFiles = false;
  window.extraFiles = 0;
  window.downloads = [];
  window.pageListReads = 0;
  window.pageReads = [];
  window.pageAborts = [];
  window.failPageReads = false;
  // Other pages for the @ picker: a page of blocks, a page that never answers (its read only ends by
  // its signal), and the page itself, which the list leaves out of the menu.
  const RELEASE = 'b1000000-0000-4000-8000-000000000001';
  const SLOW = 'b2000000-0000-4000-8000-000000000002';
  const releaseBlocks: BlockRecord[] = [
    {
      id: 'c1000000-0000-4000-8000-000000000001',
      type: 'heading',
      parent: 'root',
      pos: 'a',
      props: { level: 2 },
      text: 'Ship list',
      deleted: false,
    },
    {
      id: 'c1000000-0000-4000-8000-000000000002',
      type: 'todo',
      parent: 'root',
      pos: 'b',
      props: { checked: false },
      text: 'Tag the release',
      deleted: false,
    },
  ];
  const pages: MentionPages = {
    async list(signal) {
      window.pageListReads++;
      signal.throwIfAborted();
      return [
        { id: RELEASE, title: 'Release checklist' },
        { id: SLOW, title: 'Roadmap' },
      ];
    },
    blocks(pageId, signal) {
      window.pageReads.push(pageId);
      return new Promise((resolve, reject) => {
        let settled = false;
        signal.addEventListener(
          'abort',
          () => {
            if (settled) return;
            settled = true;
            window.pageAborts.push(pageId);
            reject(signal.reason);
          },
          { once: true },
        );
        if (pageId === SLOW) return;
        setTimeout(() => {
          if (settled) return;
          settled = true;
          if (window.failPageReads) reject(new Error('The read failed.'));
          else resolve(releaseBlocks);
        }, SERVE_MS);
      });
    },
  };
  let uploadGate: Promise<void> | undefined;
  let releaseUpload = () => {};
  window.holdUploads = () => {
    uploadGate = new Promise((resolve) => (releaseUpload = resolve));
  };
  window.releaseUploads = () => {
    uploadGate = undefined;
    releaseUpload();
  };
  const files: BlockFiles = {
    count: () => descriptors.length + window.extraFiles,
    upload: async (input: AttachmentInput) => {
      window.uploaded.push({
        filename: input.filename,
        mediaType: input.mediaType,
        size: input.bytes.length,
      });
      await uploadGate;
      if (window.failUpload) throw new Error('The upload failed.');
      const attachmentId = crypto.randomUUID();
      added.set(attachmentId, input.bytes);
      return {
        original: {
          descriptor: {
            attachmentId,
            mediaType: input.mediaType,
            plaintextBytes: String(input.bytes.length),
          },
        },
      } as unknown as StoredAttachment;
    },
  };
  const imageSource: DocumentImageInput = {
    get descriptors() {
      return descriptors;
    },
    binding: {
      scope: () => 'fixture',
      open: async (_target: unknown, descriptor: attachment.AttachmentDescriptor) => {
        window.imageReads.push(descriptor.attachmentId);
        await gate;
        if (descriptor.attachmentId === IMAGE_C && window.failImage)
          throw new Error('The read failed.');
        const bytes = added.get(descriptor.attachmentId);
        // A fresh copy per read, as a real read decrypts one: the reader may take the buffer.
        if (bytes) return bytes.slice();
        return samplePng(
          descriptor.attachmentId === IMAGE_A
            ? '#c8553d'
            : descriptor.attachmentId === IMAGE_B
              ? '#2d6a8f'
              : '#5b8c51',
        );
      },
    } as unknown as AttachmentBinding,
  };
  const mountMockup = (
    frameHost: HTMLElement,
    source: string,
    signal: AbortSignal,
    theme?: 'light' | 'dark',
  ) =>
    mountRenderer(frameHost, source, {
      signal,
      onState: () => {},
      designSystem,
      fitContent: true,
      theme,
    });
  const pageViewSource: ParentPageViewSource = (publish, failed) => {
    if (!owner) failed();
    else
      publish([
        {
          id: 'x',
          name: 'Colab 區塊',
          href: '#x',
          projects: ['Colab'],
          stage: 'Working',
          updated: '今天',
          author: 'Ben',
          access: 'Private',
        },
        {
          id: 'y',
          name: '設計系統',
          href: '#y',
          projects: ['Design'],
          stage: 'Review',
          updated: '昨天',
          author: 'Ben',
          access: 'Team',
        },
      ]);
    gated.add(failed);
    return () => gated.delete(failed);
  };
  window.serveText = (id) => blocks.find((block) => block.id === id)?.text;
  window.agentBatch = (ops) => void publish(applyOps(blocks, ops));
  window.serveProps = (id) => blocks.find((block) => block.id === id)?.props;
  window.serveMarks = (id) => blocks.find((block) => block.id === id)?.marks;
  window.serveRows = (table) =>
    new BlockTree(blocks).rows(table).map(({ id, cells }) => ({ id, ...(cells && { cells }) }));
  window.serveColumns = (table) =>
    tableColumns(blocks.find((block) => block.id === table)?.props ?? {});
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
  window.heldCommits = () => held.length;
  let refuseFirst = content === 'empty-failure';
  const send = (ops: BlockOp[], stored?: readonly StoredAttachment[]) =>
    new Promise<number>((resolve, reject) => {
      if (stored?.length) {
        // The serve refuses the whole batch, or lists the files with the blocks in one change.
        if (window.refuseFiles) {
          setTimeout(() => reject(new Error('Refused.')), SERVE_MS);
          return;
        }
        window.listedFiles.push(stored.map(({ original }) => original.descriptor.attachmentId));
        descriptors = [...descriptors, ...stored.map(({ original }) => original.descriptor)];
        for (const listener of descriptorListeners) listener(descriptors);
      }
      window.attempts.push(ops);
      const refusal = stored?.length ? undefined : refusals.shift();
      if (refusal) {
        setTimeout(() => reject(refusal()), SERVE_MS);
        return;
      }
      window.sent.push(...ops);
      const later = (commit: () => void) =>
        setTimeout(() => (holding ? held.push(commit) : commit()), SERVE_MS);
      later(() => {
        if (refuseFirst) {
          refuseFirst = false;
          reject(new Error('First insert refused'));
          return;
        }
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
  // As the page's own sender: a batch the serve refused as stale is sent again as a new one.
  const sendStale = (ops: BlockOp[], stored?: readonly StoredAttachment[]) =>
    stored?.length ? send(ops, stored) : resendStale(() => send(ops));
  function Page() {
    const [view, setView] = useState({ records: blocks, seq });
    const [pageThreads, setPageThreads] = useState(threads);
    const [listed, setListed] = useState(descriptors);
    useEffect(() => {
      descriptorListeners.add(setListed);
      return () => void descriptorListeners.delete(setListed);
    }, []);
    const pageImages = useMemo(() => ({ ...imageSource, descriptors: listed }), [listed]);
    useEffect(() => {
      threadListeners.add(setPageThreads);
      return () => void threadListeners.delete(setPageThreads);
    }, []);
    const [registry, setRegistry] = useState(questions);
    useEffect(() => {
      questionListeners.add(setRegistry);
      return () => void questionListeners.delete(setRegistry);
    }, []);
    const subscribe = useCallback((node: HTMLElement | null) => {
      if (node) listeners.add(setView);
      else listeners.delete(setView);
    }, []);
    const {
      tree,
      editing,
      focus,
      focusCell,
      cellKey,
      addRowTo,
      rowAction,
      columnAction,
      typed,
      key,
      pasteUrl,
      check,
      authoring,
      author,
      questionEdit,
      menu,
      pick,
      hover,
      closeMenu,
      selected,
      selectionFocus,
      selectionRequest,
      pageKey,
      toast,
      undo,
      blockMenu,
      act,
      move,
      openBlockMenu,
      insertAfter,
      insertFirst,
      failedFirstText,
      closeBlockMenu,
      hoverBlockMenu,
      attach,
      refuseFiles,
      uploads,
      choosing,
      mention,
      pickMention,
      hoverMention,
    } = useBlockEditing(
      view.records,
      sendStale,
      view.seq,
      content === 'spec' ? files : undefined,
      ['tmt-gui-lead', 'gui-2'],
      content === 'spec' ? pages : undefined,
    );
    return (
      <section ref={subscribe}>
        <StructuredPage
          tree={tree}
          editing={editing}
          onFocus={focus}
          onTyped={typed}
          onKey={key}
          onFocusCell={focusCell}
          onCellKey={cellKey}
          onAddRow={(table) => void addRowTo(table)}
          onRowAction={rowAction}
          onColumnAction={columnAction}
          onPasteUrl={pasteUrl}
          onChecked={check}
          authoring={authoring}
          onAuthor={author}
          onQuestionEdit={questionEdit}
          {...(content === 'spec' && {
            mountMockup,
            workSource,
            pageViewSource,
            imageSource: pageImages,
            onAttach: (picked: File[], after?: string) => void attach(picked, after),
            uploads,
            choosing,
            onDownloadFile: (id: string) => window.downloads.push(id),
            blockPageHref: (page: string, block: string) =>
              `https://colab.example/pages/${page}#block-${block}`,
            questionPage: {
              title: '區塊編輯器',
              questions: registry,
              // A question with no agent of its own goes to the page's creator.
              creator: {
                agent: { id: '50000000-0000-4000-8000-000000000004', name: 'gui-2' },
                attribution: { writerId: '30000000-0000-4000-8000-000000000001', timeMs: 1_000 },
              },
              threads: pageThreads,
              discussion,
              blocked: false,
              ...(options.recipients && {
                metadata: {
                  view: { archived: false, pageType: 'blocks', questions: registry } as PageView,
                  binding: ownerBinding,
                },
              }),
            },
          })}
          onLink={(href, newTab) => window.opened.push({ href, newTab })}
          menu={menu}
          onPick={(entry) => void pick(entry)}
          onHover={hover}
          onCloseMenu={closeMenu}
          selected={selected}
          selectionFocus={selectionFocus}
          selectionRequest={selectionRequest}
          onPageKey={pageKey}
          toast={toast}
          onFilesRefused={refuseFiles}
          onUndo={undo}
          blockMenu={blockMenu}
          onAction={act}
          onHoverAction={hoverBlockMenu}
          onCloseBlockMenu={closeBlockMenu}
          onOpenBlockMenu={openBlockMenu}
          onInsertAfter={insertAfter}
          onInsertFirst={insertFirst}
          failedFirstText={failedFirstText}
          readonly={content === 'empty-reader'}
          onMove={move}
          mention={mention}
          onPickMention={pickMention}
          onHoverMention={hoverMention}
        />
      </section>
    );
  }
  createRoot(host).render(<Page />);
}
