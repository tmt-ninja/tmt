/** Test-owned source; real Ops route, shared shell and read lifecycle. No native/Core transport. */
import { mountShell, shellRail } from '@tmt/browser-ui/shell';
import { applyStoredTheme } from '@tmt/browser-ui/theme';
import { setRouteTitle, type RemoteShell } from '../src/remote-shell.js';
import { opsPage } from '../src/ops-page.js';
import type { OpsBoard } from '../src/ops-source.js';
import {
  parseConversation,
  type ConversationPage,
  type ConversationChanges,
  type ConversationInput,
} from '../src/conversations.js';

declare global {
  interface Window {
    dmEnabled?: boolean;
    dmNewest: ConversationPage;
    dmOlder: ConversationPage;
    dmChanges: ConversationChanges;
    dmCalls: { memberId: string; input: ConversationInput }[];
    dmHold: boolean;
    dmRelease(): void;
    channelBoard: OpsBoard;
    channelReads: number;
    channelStop(): void;
    channelHold: boolean;
    channelRelease(): void;
  }
}
window.channelReads = 0;
window.channelHold = false;
window.channelBoard = {
  squads: [{ name: 'sample', lead: 'sample-lead', idleAlertMinutes: 15 }],
  agents: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'sample-lead',
      squad: 'sample',
      role: 'lead',
      state: 'working',
      presence: 'active',
      activity: { state: 'working' },
      waitingOnYou: 3,
      task: 'Review the sample plan',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'sample-1',
      squad: 'sample',
      role: 'member',
      state: 'needs-you',
      presence: 'active',
      activity: { state: 'idle' },
      waitingOnYou: 4,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'sample-2',
      squad: 'sample',
      role: 'member',
      state: 'offline',
      presence: 'offline',
      waitingOnYou: 0,
    },
  ],
  schedules: [
    {
      id: 'timer1',
      squad: 'sample',
      when: 'cron 0 * * * *',
      what: 'Sample hourly review',
      owner: 'sample-lead',
    },
  ],
  truncated: false,
};
// Deterministic UI source only: native admission and signed SDK transport have separate proofs.
window.dmCalls = [];
window.dmHold = false;
window.dmChanges = { count: 1, more: false };
const memberId = '00000000-0000-4000-8000-000000000002';
const viewerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request = 'req_cccccccc-cccc-4ccc-8ccc-cccccccccccc';
window.dmNewest = {
  viewerId,
  member: 'active',
  changePosition: 'position_1',
  nextBefore: { preparedAtMs: 1720000000000, requestId: request },
  items: [
    {
      requestId: request,
      recipientId: memberId,
      sender: { kind: 'verified', identityId: viewerId },
      direction: 'toMember',
      kind: 'request',
      origin: 'person',
      preparedAtMs: 1720000000000,
      delivery: 'sent',
      messageState: {
        state: 'answered',
        reason: { code: 'answered_by_reply', text: 'Answered by reply' },
        latestMs: 1720000001000,
        remainingMs: null,
        canSendNow: false,
      },
      final: {
        status: 'retained',
        submittedAtMs: 1720000001000,
        bodyBytes: 64,
        expiresAtMs: 1920000000000,
      },
      preview: 'Please review the release checklist before the next test run.',
      responsePreview: 'The checks passed. The remaining browser work is recorded on the issue.',
      previewTruncated: false,
      changePosition: 'item_1',
    },
  ],
};
window.dmOlder = {
  viewerId,
  member: 'active',
  changePosition: 'position_while_paging',
  nextBefore: null,
  items: [
    {
      ...window.dmNewest.items[0]!,
      requestId: 'req_dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      preparedAtMs: 1719000000000,
      final: { status: 'expired', submittedAtMs: 1719000001000, expiresAtMs: 1719900000000 },
      preview: 'An earlier review request.',
      responsePreview: null,
      previewTruncated: false,
      changePosition: 'older_item',
    },
  ],
};
applyStoredTheme();
const controller = new AbortController();
window.channelStop = () => controller.abort();
const rail = shellRail(undefined, { origin: location.origin, href: `${location.origin}/ops/` });
// This source is injected; the shell description names the real Ops module for rail ownership.
rail.main.find((item) => item.id === 'ops')!.disabled = false;
rail.main.find((item) => item.id === 'ops')!.current = true;
const shell = mountShell(document.querySelector('.tmt-ui-shell')!, { rail });
shell.setCommonControls({ openSearch() {}, remote: { kind: 'unconfirmed', href: '/remote/' } });
opsPage(
  {
    signal: controller.signal,
    setMenu: (menu) => shell.update({ rail, menu }),
    setTitle: (title, ancestors, documentTitle, chips) =>
      setRouteTitle(
        {
          ...shell,
          setTitle: (text) => {
            document.title = `${text} · TMT`;
          },
        },
        title,
        ancestors,
        documentTitle,
        chips,
      ),
  } as RemoteShell,
  {
    async board() {
      window.channelReads++;
      const board = structuredClone(window.channelBoard);
      if (window.channelHold)
        await new Promise<void>((resolve) => {
          window.channelRelease = resolve;
        });
      return board;
    },
  },
  window.dmEnabled
    ? async (selected, input) => {
        window.dmCalls.push({ memberId: selected, input: structuredClone(input) });
        if (selected !== memberId) throw new Error('No fixture for this member.');
        const page = structuredClone(input.before ? window.dmOlder : window.dmNewest);
        if (input.since !== undefined)
          page.changedSince =
            input.since === window.dmNewest.changePosition
              ? { count: 0, more: false }
              : structuredClone(window.dmChanges);
        if (window.dmHold)
          await new Promise<void>((resolve) => {
            window.dmRelease = resolve;
          });
        return {
          machineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          page: parseConversation(page, selected, input),
        };
      }
    : undefined,
);
