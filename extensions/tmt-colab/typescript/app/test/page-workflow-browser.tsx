/** Direct, private browser fixture for the open-page workflow. */
import { createRoot, type Root } from 'react-dom/client';
import { useLayoutEffect } from 'react';
import { usePageWorkflow } from '../src/use-page-workflow.js';
import { SaveRefused } from '../src/save.js';
import { localTransport, type PageBinding, type PageSummary } from '../src/transport.js';
import type { ManagementPort } from '../src/management.js';

const currentId = 'notes';
const oldId = 'old-parent';
const targetId = 'new-parent';
let root: Root | undefined;
let shown: ReturnType<typeof usePageWorkflow>;
let parent: string | undefined;
let targetPresent: boolean;
let fault: 'none' | 'refused' | 'unknown';
let calls: string[];
let holdRead = false;
let releaseRead: (() => void) | undefined;
let lifecycleReads = 0;

export function state() {
  return {
    parent,
    calls: [...calls],
    failure: shown.moveFailure,
    uncertain: shown.moveUncertain,
    busy: shown.moveBusy,
    operation: shown.pageOperation,
    operationBusy: shown.pageOperationBusy,
    operationNotice: shown.pageOperationNotice,
    lifecycleReads,
  };
}
export function removeTarget() {
  targetPresent = false;
}
export async function move() {
  return shown.movePage(targetId, 'Target');
}
export async function retry() {
  await shown.retryMove();
}
export function openArchive() {
  shown.setPageOperation('page.archive');
}
export async function archive() {
  await shown.runLifecycle();
}
export async function doubleMove() {
  holdRead = true;
  const first = shown.movePage(targetId, 'Target');
  const second = await shown.movePage(targetId, 'Target');
  holdRead = false;
  releaseRead?.();
  await first;
  return second;
}

export function mountWorkflow(nextFault: 'none' | 'refused' | 'unknown') {
  root?.unmount();
  const previous = document.getElementById('workflow-unit');
  previous?.remove();
  const host = document.createElement('div');
  host.id = 'workflow-unit';
  document.body.append(host);
  root = createRoot(host);
  parent = oldId;
  targetPresent = true;
  fault = nextFault;
  calls = [];
  holdRead = false;
  releaseRead = undefined;
  lifecycleReads = 0;
  const view = { title: 'Page', source: '<p>Page</p>' };
  const binding: PageBinding = {
    subscribe(next) {
      next(view);
      return () => {};
    },
    canWork: () => true,
    async work() {
      return {};
    },
    async edit() {
      return { merged: false };
    },
    async export() {
      throw new Error('Unused');
    },
    close() {},
  };
  const snapshot = {
    id: currentId,
    title: view.title,
    sharing: 'private' as const,
    source: view.source,
    binding,
  };
  const base = localTransport('Fixture', [snapshot]);
  const listing = (): PageSummary[] => [
    {
      id: currentId,
      title: 'Page',
      sharing: 'private',
      ...(parent
        ? {
            summary: {
              comments: 0,
              waiting: false,
              needsYou: 0,
              parent: { page: parent, index: 0 },
            },
          }
        : {}),
    },
    { id: oldId, title: 'Old', sharing: 'private' },
    ...(targetPresent ? [{ id: targetId, title: 'Target', sharing: 'private' as const }] : []),
  ];
  const transport = {
    ...base,
    management: {
      async read() {
        lifecycleReads++;
        const failure = new Error('Malformed failure');
        Object.defineProperty(failure, 'message', {
          get() {
            throw new Error('Failure could not be inspected');
          },
        });
        throw failure;
      },
      async prepare() {
        throw new Error('Unused');
      },
      async send() {
        throw new Error('Unused');
      },
      async verify() {
        throw new Error('Unused');
      },
      async setProjects() {
        throw new Error('Unused');
      },
      async manageProject() {
        throw new Error('Unused');
      },
      async setPinned() {
        throw new Error('Unused');
      },
      async newPage() {
        throw new Error('Unused');
      },
      async setDefaultTemplate() {
        throw new Error('Unused');
      },
      async readTemplates() {
        throw new Error('Unused');
      },
    } satisfies ManagementPort,
    async spaceHome() {
      if (holdRead)
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      return { title: 'Fixture', pages: listing() };
    },
    async page(id: string) {
      const listed = listing().find((item) => item.id === id);
      if (!listed) throw new Error('Page unavailable');
      return {
        ...listed,
        source: '<p>Page</p>',
        binding: {
          ...binding,
          async work(action: 'subpage.attach' | 'subpage.detach') {
            calls.push(`${id}:${action}`);
            if (action === 'subpage.detach') parent = undefined;
            if (action === 'subpage.attach') {
              if (fault === 'refused') {
                fault = 'none';
                throw new SaveRefused('refused', 'Refused');
              }
              if (fault === 'unknown') {
                fault = 'none';
                throw new Error('Unknown');
              }
              parent = id;
            }
            return {};
          },
        },
      };
    },
  };
  function Harness() {
    const workflow = usePageWorkflow(transport, snapshot, view);
    useLayoutEffect(() => {
      shown = workflow;
      host.dataset.workflowReady = 'true';
    }, [workflow]);
    return null;
  }
  root.render(<Harness />);
}
