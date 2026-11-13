/** Test-owned source; real Ops route, shared shell and read lifecycle. No native/Core transport. */
import { mountShell, shellRail } from '@tmt/browser-ui/shell';
import { applyStoredTheme } from '@tmt/browser-ui/theme';
import { setRouteTitle, type RemoteShell } from '../src/remote-shell.js';
import { opsPage } from '../src/ops-page.js';
import type { OpsBoard } from '../src/ops-source.js';
import { OrchestrationRefused } from '../src/orchestration-client.js';
import {
  parseConversation,
  type ConversationPage,
  type ConversationChanges,
  type ConversationInput,
} from '../src/conversations.js';
import type { ResultState, RoomSendInput, SendInput, SendState } from '../src/operations.js';
import type { ChannelPort } from '../src/channel-stream.js';
import type { RoomPage } from '../src/conversations.js';

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
    dmSends: SendInput[];
    dmObserved: number;
    roomPage: RoomPage;
    roomReads: number;
    roomSends: RoomSendInput[];
    roomSendState: SendState | null;
    roomResults: Record<string, ResultState>;
    dmSendState: SendState | null;
    channelReads: number;
    channelStop(): void;
    channelHold: boolean;
    channelRelease(): void;
    orchCalls: { kind: 'read' | 'write'; input: Record<string, unknown> }[];
    orchRefuseApply?: string;
  }
}
window.channelReads = 0;
window.channelHold = false;
window.channelBoard = {
  defaultIdleAlertMs: null,
  squads: [{ room: null, name: 'sample', lead: 'sample-lead', idleAlertMs: 900_000 }],
  agents: [
    {
      tokens1d: null,
      checklistCount: null,
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
      tokens1d: null,
      checklistCount: null,
      id: '00000000-0000-4000-8000-000000000002',
      name: 'sample-1',
      squad: 'sample',
      role: 'member',
      state: 'idle',
      presence: 'active',
      activity: { state: 'idle' },
      waitingOnYou: 4,
    },
    {
      tokens1d: null,
      checklistCount: null,
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
      nextMs: null,
      state: null,
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
window.dmSends = [];
window.dmObserved = 0;
window.dmSendState = null;
window.roomPage = {
  roomId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
  items: [],
  nextBefore: null,
  changes: 'unknown',
};
window.roomReads = 0;
window.roomSends = [];
window.roomSendState = null;
window.roomResults = {};
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
// Orchestration answers as Core would through the door, with Core's own value words: three plans in
// Asia/Tokyo over Tue 2026-10-27, nine members, a focus and a member talk limit. Core's own rules
// have native proofs; this only resolves enough for the page to show filled states.
const lead = '00000000-0000-4000-8000-000000000001';
const member1 = '00000000-0000-4000-8000-000000000002';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DAY0 = Date.UTC(2026, 9, 26, 15); // Tue 2026-10-27 00:00 in Asia/Tokyo
const NOW = DAY0 + 23 * HOUR;
const orchId = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const orchMembers = [
  { identityId: orchId(11), name: 'tmt-lead' },
  { identityId: orchId(12), name: 'core-1' },
  { identityId: orchId(13), name: 'core-2' },
  { identityId: orchId(14), name: 'gui-1' },
  { identityId: orchId(15), name: 'night-1' },
  { identityId: orchId(16), name: 'night-2' },
  { identityId: lead, name: 'sample-lead' },
  { identityId: member1, name: 'sample-1' },
  { identityId: '00000000-0000-4000-8000-000000000003', name: 'sample-2' },
];
const orchLeads = new Set([orchId(11), lead]);
type OrchFields = Partial<
  Record<'state' | 'receiving' | 'sending' | 'routine' | 'talkLimit', unknown>
>;
const orchPlans = [
  {
    id: 'plan-freeze',
    name: 'Release freeze',
    revision: 1,
    priority: 30,
    enabled: true,
    targets: [{ kind: 'identity', id: orchId(12) }],
    schedule: {
      kind: 'once',
      startMs: DAY0 + 2 * DAY + 9 * HOUR,
      endMs: DAY0 + 2 * DAY + 18 * HOUR,
    },
    fields: { routine: 'hold', sending: 'leads' } as OrchFields,
    members: [],
  },
  {
    id: 'plan-shift-b',
    name: 'Shift B · Night',
    revision: 4,
    priority: 20,
    enabled: true,
    targets: [{ kind: 'pattern', pattern: 'night-*' }],
    schedule: {
      kind: 'weekly',
      anchorDate: '2026-10-26',
      intervalWeeks: 2,
      weekdays: [2, 4],
      start: '22:00',
      end: '06:00',
      allDay: false,
    },
    fields: {
      state: 'awake',
      receiving: { mode: 'direct' },
      sending: 'leads',
      talkLimit: 20,
    } as OrchFields,
    members: [],
  },
  {
    id: 'plan-quiet',
    name: 'Quiet hours',
    revision: 2,
    priority: 10,
    enabled: true,
    targets: [{ kind: 'all' }],
    schedule: {
      kind: 'weekly',
      anchorDate: '2026-10-26',
      intervalWeeks: 1,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      start: '22:00',
      end: '08:00',
      allDay: false,
    },
    fields: { state: 'low', receiving: { mode: 'batch', intervalMs: 1_800_000 } } as OrchFields,
    members: [],
  },
];
/** Each plan's windows from the day before the range through 31 days, by its weekly rule. */
const orchWindows = new Map(
  orchPlans.map((plan) => {
    const rule = plan.schedule;
    if (rule.kind === 'once') return [plan.id, [[rule.startMs!, rule.endMs!]]];
    const windows: number[][] = [];
    const clock = (text: string) =>
      Number(text.slice(0, 2)) * HOUR + Number(text.slice(3)) * 60_000;
    for (let day = -1; day <= 31; day++) {
      const weekday = ((((day + 1) % 7) + 7) % 7) + 1; // DAY0 is a Tuesday, ISO 2
      const week = Math.floor((day + 1) / 7); // weeks since Monday 2026-10-26
      if (!rule.weekdays!.includes(weekday) || week % rule.intervalWeeks! !== 0) continue;
      const start = DAY0 + day * DAY + clock(rule.start!);
      const end = DAY0 + day * DAY + clock(rule.end!) + (rule.end! <= rule.start! ? DAY : 0);
      windows.push([start, end]);
    }
    return [plan.id, windows];
  }),
);
const inEffect = (planId: string, at: number) =>
  orchWindows.get(planId)!.some(([start, end]) => start! <= at && at < end!);
const targets = (plan: (typeof orchPlans)[number], member: (typeof orchMembers)[number]) =>
  (plan.targets as { kind: string; id?: string; pattern?: string }[]).some((t) =>
    t.kind === 'all'
      ? true
      : t.kind === 'identity'
        ? t.id === member.identityId
        : member.name.startsWith(t.pattern!.replace('*', '')),
  );
// gui-1 is in personal focus 22:00–01:00; sample-1 keeps its own talk limit.
const FOCUS = [DAY0 + 22 * HOUR, DAY0 + 25 * HOUR];
function orchEffective(member: (typeof orchMembers)[number], at: number) {
  const active = orchPlans.filter((plan) => targets(plan, member) && inEffect(plan.id, at));
  const base: Required<OrchFields> = {
    state: 'awake',
    receiving: { mode: 'direct' },
    sending: 'anyone',
    routine: 'run',
    talkLimit: null,
  };
  const effective: Record<string, { value: unknown; source: Record<string, unknown> }> = {};
  for (const key of Object.keys(base) as (keyof OrchFields)[]) {
    const plan = active.find((p) => key in p.fields);
    effective[key] = plan
      ? { value: plan.fields[key], source: { kind: 'plan', planId: plan.id } }
      : { value: base[key], source: { kind: 'base', planId: null } };
  }
  if (member.identityId === orchId(14) && FOCUS[0]! <= at && at < FOCUS[1]!) {
    effective.state = { value: 'focus', source: { kind: 'focus', planId: null } };
    effective.receiving = { value: { mode: 'urgent' }, source: { kind: 'focus', planId: null } };
    effective.routine = { value: 'hold', source: { kind: 'focus', planId: null } };
  }
  if (member.identityId === member1)
    effective.talkLimit = { value: 12, source: { kind: 'member', planId: null } };
  (effective.receiving as Record<string, unknown>).available = true;
  const edges = orchPlans
    .filter((p) => targets(p, member))
    .flatMap((p) => orchWindows.get(p.id)!.flat());
  if (member.identityId === orchId(14)) edges.push(...FOCUS);
  const next = edges.filter((edge) => edge > at).sort((a, b) => a - b)[0] ?? null;
  return { effective, activePlans: active.map((p) => p.id), nextChangeAtMs: next };
}
const matching = (query: unknown) =>
  orchMembers.filter((m) => typeof query !== 'string' || m.name.includes(query));
const orchJobs: Record<string, Record<string, unknown>[]> = {
  [orchId(15)]: [
    {
      title: 'Night review',
      schedule: { kind: 'every', seconds: 3600 },
      state: 'on',
      next: NOW + HOUR,
    },
    {
      title: 'Archive review',
      schedule: { kind: 'at', at: '23:30', on: null },
      state: 'paused',
      next: null,
    },
  ],
  [orchId(12)]: [
    {
      title: 'Queue review',
      schedule: { kind: 'every', seconds: 1800 },
      state: 'on',
      next: NOW + HOUR / 2,
    },
  ],
  [orchId(14)]: [
    {
      title: 'UI check',
      schedule: { kind: 'every', seconds: 3600 },
      state: 'held',
      next: NOW + HOUR,
    },
  ],
  [lead]: [
    {
      title: 'Sample hourly review',
      schedule: { kind: 'cron', expression: '0 * * * *' },
      state: 'on',
      next: NOW + HOUR,
    },
  ],
};
window.orchCalls = [];
const orchestration = {
  async read(input: Record<string, unknown>) {
    window.orchCalls.push({ kind: 'read', input: structuredClone(input) });
    if (input.view === 'overview') {
      const days = typeof input.rangeDays === 'number' ? input.rangeDays : 1;
      const at = typeof input.atMs === 'number' ? input.atMs : NOW;
      const start = DAY0;
      const end = start + days * DAY;
      const selected = typeof input.plan === 'string' ? input.plan : null;
      const shown = orchPlans.filter((plan) => !selected || plan.id === selected);
      const edges = [
        ...new Set([
          start,
          end,
          ...shown
            .flatMap((p) => orchWindows.get(p.id)!.flat())
            .filter((e) => e > start && e < end),
        ]),
      ].sort((a, b) => a - b);
      const timeline: { startMs: number; endMs: number; planIds: string[] }[] = [];
      for (let i = 0; i + 1 < edges.length; i++) {
        const planIds = shown.filter((p) => inEffect(p.id, edges[i]!)).map((p) => p.id);
        const last = timeline.at(-1);
        if (last && last.planIds.join() === planIds.join()) last.endMs = edges[i + 1]!;
        else timeline.push({ startMs: edges[i]!, endMs: edges[i + 1]!, planIds });
      }
      return {
        schemaVersion: 1,
        configurationRevision: 3,
        receivingRevision: 1,
        observedAtMs: NOW,
        atMs: at,
        timeZone: 'Asia/Tokyo',
        range: { startMs: start, endMs: end },
        selectedPlanId: selected,
        plans: orchPlans,
        members: matching(input.memberQuery).map((m) => ({
          identityId: m.identityId,
          name: m.name,
          ...orchEffective(m, at),
          jobs: null,
        })),
        timeline,
        emptyState: null,
      };
    }
    if (input.view === 'routes') {
      const members = matching(input.memberQuery);
      const routes = members.flatMap((from) =>
        members
          .filter((to) => to !== from)
          .map((to) => {
            const sending = orchEffective(from, NOW).effective.sending!;
            const toLead = orchLeads.has(to.identityId);
            if (sending.value === 'paused' || (sending.value === 'leads' && !toLead))
              return {
                from: from.identityId,
                to: to.identityId,
                verdict: 'blocked',
                source: sending.source,
              };
            if (from.identityId === member1 && to.identityId === lead)
              return {
                from: from.identityId,
                to: to.identityId,
                verdict: 'needs_person',
                source: { kind: 'member', planId: null },
              };
            return {
              from: from.identityId,
              to: to.identityId,
              verdict: 'allowed',
              source: sending.source,
            };
          }),
      );
      return {
        schemaVersion: 1,
        configurationRevision: 3,
        observedAtMs: NOW,
        routes,
        nextAfter: null,
      };
    }
    if (input.view === 'jobs') {
      const jobs = (orchJobs[input.ownerIdentityId as string] ?? []).map((job, index) => ({
        jobId: `job-${String(input.ownerIdentityId).slice(-2)}-${index}`,
        displayId: `j${index + 1}`,
        revision: 1,
        target: { squadRoomId: null, identityId: input.ownerIdentityId, identityName: null },
        title: job.title,
        messagePreview: `${String(job.title)}: check and report.`,
        schedule: { zone: 'Asia/Tokyo', ...(job.schedule as object) },
        state: job.state,
        nextRunAtMs: job.next,
        lastRun: null,
      }));
      return { schemaVersion: 1, observedAtMs: NOW, jobs, nextCursor: null };
    }
    if (input.view === 'talks')
      return {
        pairs: [
          {
            members: [
              { identityId: lead, name: 'sample-lead' },
              { identityId: member1, name: 'sample-1' },
            ],
            count: 12,
            limit: 12,
            state: 'held',
            heldCount: 2,
          },
          {
            members: [
              { identityId: orchId(15), name: 'night-1' },
              { identityId: orchId(16), name: 'night-2' },
            ],
            count: 7,
            limit: 20,
            state: 'open',
            heldCount: 0,
          },
        ],
      };
    if (input.view === 'why')
      return {
        items: [{ action: 'route', outcome: 'blocked', reason: 'Night shift: members only' }],
      };
    throw new OrchestrationRefused('ORCH_INPUT_INVALID');
  },
  async write(input: Record<string, unknown>) {
    window.orchCalls.push({ kind: 'write', input: structuredClone(input) });
    if (input.phase === 'preview')
      return {
        mutation: input.mutation,
        configurationRevision: 3,
        previewAtMs: 1720000000000,
        previewDigest: 'digest-1',
        changes: [{ identityId: member1, fields: ['state', 'receiving'] }],
        releases: 2,
        held: [{}, {}],
      };
    if (window.orchRefuseApply) throw new OrchestrationRefused(window.orchRefuseApply);
    return { applied: true, configurationRevision: 4 };
  },
};
/** A Talk answer for the operation asked about: the fixture's state, else accepted. */
const answer = (state: SendState | null, operationId: string, requestId: string): SendState =>
  state ? ({ ...state, operationId } as SendState) : { state: 'accepted', operationId, requestId };
const room: ChannelPort = {
  async readRoom() {
    window.roomReads++;
    return structuredClone(window.roomPage);
  },
  async result(requestId) {
    return window.roomResults[requestId] ?? { state: 'pending', requestId };
  },
  async send(input) {
    window.roomSends.push(structuredClone(input));
    return answer(
      window.roomSendState,
      input.operationId,
      'req_00000010-cccc-4ccc-8ccc-cccccccccccc',
    );
  },
  async operation(operationId) {
    return answer(window.roomSendState, operationId, 'req_00000010-cccc-4ccc-8ccc-cccccccccccc');
  },
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
  async () => orchestration,
  {
    async send(input) {
      window.dmSends.push(structuredClone(input));
      return answer(
        window.dmSendState,
        input.operationId,
        'req_00000009-cccc-4ccc-8ccc-cccccccccccc',
      );
    },
    async operation(operationId) {
      window.dmObserved++;
      return answer(window.dmSendState, operationId, 'req_00000009-cccc-4ccc-8ccc-cccccccccccc');
    },
  },
  room,
);
