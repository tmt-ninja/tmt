/** Controlled parent fixture. Authority, revisions and directory states are injected, not native proof. */
import 'virtual:tokens.css';
import '@tmt/browser-ui/static.css';
import '../src/style.css';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { createAppRouter } from '../src/router.js';
import { localTransport, type PageBinding, type PageView } from '../src/transport.js';
import type { AskBinding } from '../src/ask-panel.js';
import type { RegisteredQuestion } from '../src/question-registry.js';
import type { ThreadView } from '../src/thread-records.js';
import type { MetadataAction } from '../src/save.js';
import { SaveRefused } from '../src/save.js';
import { PageOperationDialog } from '../src/page-operation-dialog.js';
import type { ManagementPort, NewPageRequest } from '../src/management.js';
import { destination, id } from './ask-fixtures.js';
import vector from '../../../contracts/vectors/discussion-v1.json';

const pageId = id(90);
const q = (n: number) => id(100 + n);
const attribution = { writerId: id(4), timeMs: 1 };
const source = `<h1>Metadata page</h1><tmt-questions data-id="${id(200)}"><p data-title>Two questions</p>${[1, 2].map((n) => `<tmt-question data-id="${q(n)}" data-kind="short"><p data-question>${n === 1 ? 'First' : 'Second'} question</p></tmt-question>`).join('')}</tmt-questions><p>Retain this source while changing metadata.</p>`;
const registry: RegisteredQuestion[] = [1, 2, 3, 4].map((n) => ({
  id: q(n),
  title: ['First question', 'Second question', 'Handled question', 'Removed question'][n - 1],
  state: n === 3 ? 'handled' : 'open',
  attribution,
}));
const comment = {
  ...vector.comment,
  ref: { writer: id(4), id: id(5) },
  body: 'Answer to “Second question”: Yes\nPage: Metadata page',
  deviceAuthor: true,
  sequence: '1',
  questionId: q(2),
};
let view: PageView = {
  title: 'Metadata page',
  source,
  originalAuthor: 'Original author',
  creator: { agent: { id: id(6), name: 'First creator' }, attribution },
  questions: registry,
  threads: [
    { ...vector.thread, ref: { writer: id(2), id: id(3) }, comments: [comment] } as ThreadView,
  ],
  asks: [],
};
let revision = 'revision-1';
let publish: ((value: PageView) => void) | undefined;
let mode: 'ready' | 'unavailable' | 'stale' | 'pending' = 'ready';
const owner = new URLSearchParams(location.search).get('role') !== 'editor';
let finish: (() => void) | undefined;
const commands: { action: MetadataAction; body: Record<string, unknown>; expected: string }[] = [];
const ask = {
  async destinations() {
    if (mode === 'unavailable') throw new Error('Directory unavailable');
    return [6, 7].map((n) => ({
      ...destination(),
      agent: id(n),
      agentName: n === 6 ? 'First creator' : 'Next creator',
      presence: 'offline',
    }));
  },
} as AskBinding;
const binding: PageBinding = {
  ask,
  canMetadata: () => owner,
  async metadataRevision() {
    return revision;
  },
  async metadata(action, body, expected) {
    commands.push({ action, body: structuredClone(body), expected });
    if (mode === 'pending')
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    if (mode === 'stale' || expected !== revision)
      throw new SaveRefused('COLAB_STALE_BASE', 'Page changed. Read it again before writing.');
    if (action === 'page.convert') {
      view = { ...view, pageType: 'blocks', blocks: {}, convertedAt: 123 };
    } else if (action === 'page.revert') {
      const { pageType: _type, blocks: _blocks, convertedAt: _convertedAt, ...rest } = view;
      view = rest;
    } else if (action === 'template.set') {
      // The owner refuses a name another page carries (#5077); the fixture names one.
      if (body.name === 'weekly-review')
        throw new SaveRefused('COLAB_TEMPLATE_NAME_TAKEN', 'weekly-review is already a template');
      view = {
        ...view,
        template: { name: body.name as string, description: (body.description as string) ?? '' },
      };
    } else if (action === 'template.clear') {
      const { template: _template, ...rest } = view;
      view = rest;
    } else if (action === 'creator.set')
      view = {
        ...view,
        creator: { agent: body.agent as { id: string; name: string }, attribution },
      };
    else
      view = {
        ...view,
        questions: view.questions!.map((entry) =>
          entry.id === body.id
            ? { ...entry, state: action === 'question.handle' ? 'handled' : 'open' }
            : entry,
        ),
      };
    revision = `revision-${commands.length + 1}`;
    publish?.(structuredClone(view));
  },
  subscribe(next) {
    publish = next;
    next(structuredClone(view));
    return () => {
      publish = undefined;
    };
  },
  async edit(next) {
    view = { ...view, source: next };
    publish?.(structuredClone(view));
    return { merged: false };
  },
  async export() {
    throw new Error('Unexpected export');
  },
  close() {},
};
export function setMode(next: typeof mode) {
  mode = next;
}
export function settle() {
  finish?.();
  finish = undefined;
}
export function proof() {
  return { commands, revision, view };
}
let referenceRoot: Root | undefined;
let referenceNode: HTMLElement | undefined;
export function showArchiveReference() {
  referenceNode = document.createElement('div');
  document.body.append(referenceNode);
  referenceRoot = createRoot(referenceNode);
  referenceRoot.render(
    <PageOperationDialog
      operation="page.archive"
      titles={['Metadata page']}
      busy={false}
      onCancel={hideArchiveReference}
      onConfirm={hideArchiveReference}
    />,
  );
}
export function hideArchiveReference() {
  referenceRoot?.unmount();
  referenceNode?.remove();
  referenceRoot = undefined;
  referenceNode = undefined;
}
export function addExampleBlock() {
  view = {
    ...view,
    blocks: {
      [id(401)]: {
        type: 'paragraph',
        parent: 'root',
        pos: 'V',
        props: {},
        text: { s: 'New block', marks: [] },
      },
    },
  };
  revision = 'revision-changed';
  publish?.(structuredClone(view));
}
export function checking() {
  view = { ...view, discussionPending: true, threads: undefined };
  publish?.(structuredClone(view));
}
const local = localTransport('Metadata fixture', [
  { id: pageId, sharing: 'private', binding, ...view },
]);
/** The owner's templates and creates (#5076, #5077): only what the page's template chrome uses. */
export const newPages: NewPageRequest[] = [];
const transport =
  new URLSearchParams(location.search).get('owner') === 'templates'
    ? {
        ...local,
        management: {
          readTemplates: async () => ({
            default: 'starter',
            templates: [
              ...['starter', 'report'].map((name) => ({
                name,
                layout: 'column' as const,
                summary: `${name} summary`,
                source: 'builtIn' as const,
                default: name === 'starter',
                usedBy: 0,
              })),
              {
                name: 'weekly-review',
                id: id(300),
                layout: 'column' as const,
                summary: 'Shipped, open, risks, next week',
                source: 'space' as const,
                default: false,
                usedBy: 4,
                author: 'ben',
              },
              ...(view.template
                ? [
                    {
                      name: view.template.name,
                      id: pageId,
                      layout: 'column' as const,
                      summary: view.template.description,
                      source: 'space' as const,
                      default: false,
                      usedBy: 0,
                    },
                  ]
                : []),
            ],
          }),
          newPage: async (request: NewPageRequest) => {
            newPages.push(request);
            return id(301);
          },
        } as unknown as ManagementPort,
      }
    : local;
createRoot(document.getElementById('root')!).render(
  <RouterProvider router={createAppRouter(transport)} />,
);
location.hash = `/pages/${pageId}`;

/** The same hand-authored admitted registry/answer corpus consumed by native projection tests. */
export function registryVector(input: {
  registry: RegisteredQuestion[];
  threads: { writer: string; id: string; deleted: boolean; comments: Record<string, unknown>[] }[];
  deviceWriters: string[];
}) {
  view = {
    ...view,
    source: '<h1>Metadata page</h1>',
    questions: input.registry,
    threads: input.threads.map((thread) => ({
      ...vector.thread,
      anchor: null,
      deleted: thread.deleted,
      senderDevice: thread.writer,
      threadId: thread.id,
      ref: { writer: thread.writer, id: thread.id },
      comments: thread.comments.map((record) => ({
        ...vector.comment,
        ...record,
        senderDevice: record.writer,
        messageId: record.id,
        ref: { writer: record.writer, id: record.id },
        thread: { writer: thread.writer, id: thread.id },
        deviceAuthor: input.deviceWriters.includes(record.writer as string),
      })),
    })) as ThreadView[],
  };
  publish?.(structuredClone(view));
}

/** The registry and legacy markup may use the same ID in their distinct target domains. */
export function readingCollision() {
  view = {
    ...view,
    source: `<h1>Metadata page</h1><tmt-read data-id="${q(1)}" data-agent="First creator" data-why="Read first"><h2 data-title>Same ID reading</h2><p>Read this passage.</p></tmt-read>`,
  };
  publish?.(structuredClone(view));
}

export function longLabels() {
  view = {
    ...view,
    questions: view.questions!.map((entry) => ({
      ...entry,
      title:
        'A deliberately long question title that must wrap inside a short phone dialog without hiding its actions',
    })),
  };
  publish?.(structuredClone(view));
}

export function legacyCreator(originalAuthor?: string) {
  view = {
    ...view,
    creator: undefined,
    creationRecipient: { machineId: id(4), agentId: id(6) },
    originalAuthor,
  };
  publish?.(structuredClone(view));
}

export function emptyRegistry() {
  view = { ...view, questions: [] };
  publish?.(structuredClone(view));
}
