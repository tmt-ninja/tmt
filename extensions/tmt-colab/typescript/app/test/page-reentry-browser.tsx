/** Two local pages and a hold on opening them, to watch what shows while a page is entered again. */
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import {
  blockDraftStore,
  ownerBlockDraftStore,
  type BlockDraftAdmission,
  type BlockDraftStore,
} from '../src/block-drafts.js';
import type { Sealed } from '../src/local-seal.js';
import { createAppRouter } from '../src/router.js';
import { deleteRecord, record } from '../src/storage.js';
import { localTransport, type PageSnapshot } from '../src/transport.js';

declare global {
  interface Window {
    /** Page IDs the transport was asked to open, in order. */
    pageOpens: string[];
    /** While set, opening a page waits for it (the open is "slow"). */
    holdPages?: Promise<void>;
    /** When set, a held open that is released fails with this message, as a real open failure. */
    failPages?: string;
    /** Fail the live page's binding, after the page has opened. */
    endDraftPage?: (code: string) => void;
    draftProbe?: Promise<void>;
    fixtureDraftKeyExists?: () => Promise<boolean>;
    fixtureSealedDraft?: () => Promise<Sealed | undefined>;
    fixtureRecoveryIssueSeen?: () => Promise<boolean>;
    fixtureSaveDeviceDraft?: (value: string) => Promise<boolean>;
  }
}
const ID = {
  alpha: 'c0000001-1111-4111-8111-000000000001',
  beta: 'c0000002-1111-4111-8111-000000000001',
};
let root: Root | undefined;

export async function mount(draft?: {
  mode: 'readable' | 'unreadable' | 'empty' | 'missing-key-recovery' | 'owner-ended';
  value: string;
}) {
  document.getElementById('root')!.style.display = 'none';
  let host = document.getElementById('reentry-fixture');
  if (!host) {
    host = document.createElement('div');
    host.id = 'reentry-fixture';
    document.body.append(host);
  }
  root?.unmount();
  root = createRoot(host);
  window.pageOpens = [];
  const snapshots: PageSnapshot[] = [
    ['alpha', 'Alpha plan'],
    ['beta', 'Beta review'],
  ].map(([key, title], n) => ({
    id: ID[key as keyof typeof ID],
    title,
    sharing: 'private' as const,
    archived: false,
    lastUpdateAtMs: Date.UTC(2026, 9, 9) - n * 3600_000,
    retentionDays: 30,
    expiresAtMs: null,
    warnings: [],
    projects: [],
    source: `<h1>${title}</h1><p>Body of ${title}.</p>`,
  }));
  const base = localTransport('Studio pages', snapshots);
  const drafts = draft && blockDraftStore('fixture', 'fixture-device');
  const recovering = draft?.mode === 'missing-key-recovery';
  const ownerEnded = draft?.mode === 'owner-ended';
  const owner = { root: 'fixture-owner-root', session: {} };
  let admission: BlockDraftAdmission | undefined = owner;
  const ownerDrafts =
    recovering || ownerEnded
      ? ownerBlockDraftStore('fixture', 'replacement-device', () => admission)
      : undefined;
  const seed = (store: BlockDraftStore, value: string) =>
    store.save(ID.alpha, {
      target: 'fixture-target',
      generation: 'fixture-generation',
      id: 'fixture-block',
      base: 'Text already on the page.',
      value,
    });
  if (draft && drafts && draft.mode !== 'empty') {
    const target = ownerEnded ? ownerDrafts : drafts;
    if (!target || !(await seed(target, draft.value)))
      throw new Error('Could not seed the block draft');
    if (draft.mode === 'unreadable' || recovering) await deleteRecord('draft-key:fixture-device');
  }
  window.fixtureDraftKeyExists = async () => !!(await record('draft-key:fixture-device'));
  window.fixtureSealedDraft = () => record(`block-drafts:fixture:fixture-device:${ID.alpha}`);
  window.fixtureRecoveryIssueSeen = async () =>
    !!(await record(`owner-block-draft-seen:fixture:${owner.root}:${ID.alpha}`));
  window.fixtureSaveDeviceDraft = drafts ? (value) => seed(drafts, value) : undefined;
  let probed: () => void;
  window.draftProbe = new Promise<void>((resolve) => {
    probed = resolve;
  });
  const router = createAppRouter({
    ...base,
    blockDrafts: drafts && {
      ...drafts,
      load: async (page) => {
        try {
          return await drafts.load(page);
        } finally {
          probed();
        }
      },
    },
    async page(id, signal) {
      window.pageOpens.push(id);
      await window.holdPages;
      if (window.failPages) throw new Error(window.failPages);
      const snapshot = await base.page(id, signal);
      if (!draft || id !== ID.alpha) return snapshot;
      return {
        ...snapshot,
        pageType: 'blocks',
        blocks: {
          'fixture-block': {
            type: 'paragraph',
            parent: 'root',
            pos: 'V',
            props: {},
            text: { s: 'Text already on the page.', marks: [] },
          },
        },
        binding: {
          ...(ownerDrafts && {
            blockDrafts: ownerDrafts,
            blocks: async () => {
              throw new Error('Kept drafts must wait for explicit recovery');
            },
          }),
          subscribe(_publish, failed) {
            window.endDraftPage = (code) => {
              admission = undefined;
              failed(new Error(code));
            };
            return () => delete window.endDraftPage;
          },
          edit: async () => ({ merged: false }),
          export: async () => {
            throw new Error('No fixture export');
          },
          close() {},
        },
      };
    },
  });
  location.hash = '/';
  root.render(<RouterProvider router={router} />);
}
export { ID };
