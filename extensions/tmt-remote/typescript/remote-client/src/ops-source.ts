/**
 * What the Ops web view (`/ops/`) reads: the owner's squad board through the owner browser read
 * `x/-/ops` (contracts/remote-channel-v1.md, Owner browser reads), read-only. The page depends only
 * on `OpsSource`; this module turns the read's allowlisted projection into the page's rows.
 */
import { coreId } from './operations.js';
import { ownerRead, type OwnerReadAnswer, type OwnerReadReason } from './owner-reads.js';
import { forgetDrafts } from './ops-composer-slot.js';
/** The shared state marks (c5ccd17a §4): always a mark and a word. The mark is a leaf shape
 * (`tmt-ui-state-mark`), the same box for every state. */
export type AgentState = 'working' | 'idle' | 'offline' | 'unknown';
export type AgentMark = 'dot' | 'ring' | 'unknown';
/** Each state's mark, word and chip tone. Working and idle are both dots: working takes the
 * working colour (`markTone`), idle the text's own; offline is a ring and unknown a question mark.
 * A dashed ring read as loading. */
export const AGENT_STATES: Record<
  AgentState,
  { mark: AgentMark; markTone?: 'working'; word: string; tone: string }
> = {
  working: { mark: 'dot', markTone: 'working', word: 'Working', tone: 'neutral' },
  idle: { mark: 'dot', word: 'Idle', tone: 'neutral' },
  offline: { mark: 'ring', word: 'Offline', tone: 'neutral' },
  unknown: { mark: 'unknown', word: 'Unknown', tone: 'neutral' },
};

/** The board's colour for a member's task state, as the page draws it: Ops' colour roles and
 * their older names (`red`, `amber`, `green`, `magenta`); any other token is neutral. */
export type TaskTone = 'working' | 'waiting' | 'blocked' | 'review' | 'muted';
const TASK_TONES: Readonly<Record<string, TaskTone>> = {
  working: 'working',
  green: 'working',
  waiting: 'waiting',
  amber: 'waiting',
  blocked: 'blocked',
  red: 'blocked',
  review: 'review',
  magenta: 'review',
  dim: 'muted',
};

/** What a squad owes the person, as the owner's board counts it: members waiting on the person (a
 * pending decision or a request) and members whose task is blocked. */
export interface OpsAttention {
  state: 'normal' | 'waiting' | 'blocked';
  waiting: number;
  blocked: number;
}

export interface OpsAgent {
  /** Stable member identity; names and squad labels grant no authority. */
  id: string;
  presence?: string;
  /** The provider's activity, and since when, when the owner reports one. */
  activity?: { state: string; sinceMs?: number };
  name: string;
  squad: string;
  role: 'lead' | 'member';
  state: AgentState;
  /** The task state as the board row says it (free text such as `review` or `blocked: CI`),
   * apart from presence and activity, with the board's colour for it when the page knows it. */
  taskState?: string;
  taskTone?: TaskTone;
  /** `stale` when the row's notes may be out of date (Ops' staleness token). */
  staleness?: 'fresh' | 'stale';
  /** What the board row says the agent works on, or nothing. */
  task?: string;
  next?: string;
  /** What the agent waits on the person for. */
  pending?: string;
  model?: string;
  /** Requests waiting on the person. */
  waitingOnYou: number;
  tokens1d: { tokens: number; complete: boolean } | null;
  checklistCount: number | null;
}
export interface OpsSquad {
  name: string;
  room: { roomId: string; revision: number } | null;
  lead?: string;
  /** Effective squad alert interval, as supplied by the owner read. */
  idleAlertMs?: number;
  attention?: OpsAttention;
}
export interface OpsSchedule {
  id: string;
  nextMs: number | null;
  state: 'on' | 'paused' | null;
  squad: string;
  /** The schedule as the board shows it, such as `cron 35 * * * *`. */
  when: string;
  what: string;
  owner?: string;
}
export interface OpsBoard {
  /** Workspace default, null when the owner cannot report it. */
  defaultIdleAlertMs: number | null;
  agents: readonly OpsAgent[];
  squads: readonly OpsSquad[];
  /** `null` when the owner could not read the schedules: never shown as no timers. */
  schedules: readonly OpsSchedule[] | null;
  /** The owner cut the board to the read's bounds. */
  truncated: boolean;
  /** Why there is no board to show; every list is then empty. */
  unavailable?: string;
}
export interface OpsSource {
  board(signal: AbortSignal): Promise<OpsBoard>;
}

/** The `x/-/ops` payload (contract: Ops payload); every text field is already bounded and inert. */
export interface OpsPayload {
  defaultIdleAlertMs?: number | null;
  squads: readonly {
    name: string;
    room?: { roomId: string; revision: number } | null;
    lead?: { id: string; name: string };
    idleAlertMs?: number;
    attention?: { state: string; waiting: number; blocked: number };
  }[];
  agents: readonly {
    id: string;
    name: string;
    squad: string;
    role: 'lead' | 'member';
    presence?: string;
    activity?: { state: string; sinceMs?: number | null };
    state?: string;
    stateTone?: string;
    task?: string;
    next?: string;
    model?: string;
    pending?: string;
    waitingOnYou: number;
    tokens1d?: { tokens: number; complete: boolean } | null;
    checklistCount?: number | null;
    staleness?: string;
  }[];
  timers:
    | readonly {
        id: string;
        squad: string;
        scheduleText: string;
        owner?: string;
        what?: string;
        nextMs?: number | null;
        state?: 'on' | 'paused' | null;
      }[]
    | null;
  truncated: boolean;
}

/** The four uncoloured states exposed by the board; pending is not presence. */
function agentState(agent: OpsPayload['agents'][number]): AgentState {
  if (agent.presence === 'offline') return 'offline';
  // The provider's activity when it reports one; otherwise the state the board was told.
  const state = agent.activity?.state ?? agent.state;
  return state === 'working' || state === 'idle' ? state : 'unknown';
}

/** One plain sentence per reason, each saying what the person can do. */
const REASONS: Record<OwnerReadReason | 'no-session' | 'unreachable', string> = {
  not_installed:
    'Ops is not installed on your machine. Run `tmt extension install ops`, then reload this page.',
  core_unavailable: 'TMT on your machine did not answer. This page tries again shortly.',
  timeout: 'Your machine took too long to read the board. This page tries again shortly.',
  read_failed: 'Your machine could not read the board. Run `tmt ops ui` in a terminal to see it.',
  too_large: 'The board is too large for the browser. Run `tmt ops ui` in a terminal to see it.',
  not_sampled: 'Your machine could not read the board. Run `tmt ops ui` in a terminal to see it.',
  unknown: 'The board is not available right now. Run `tmt ops ui` in a terminal to see it.',
  'no-session':
    'This browser has no owner session for your machine. Pair it from Remote to see the board.',
  unreachable: 'Your machine did not answer. This page tries again shortly.',
};
function unavailableBoard(reason: OwnerReadReason | 'no-session' | 'unreachable'): OpsBoard {
  return {
    agents: [],
    squads: [],
    schedules: [],
    defaultIdleAlertMs: null,
    truncated: false,
    unavailable: REASONS[reason],
  };
}

const safeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function attention(
  value: NonNullable<OpsPayload['squads'][number]['attention']>,
): OpsAttention | undefined {
  if (!safeNumber(value.waiting) || !safeNumber(value.blocked)) return undefined;
  const { state, waiting, blocked } = value;
  return state === 'normal' || state === 'waiting' || state === 'blocked'
    ? { state, waiting, blocked }
    : undefined;
}
function usage1d(value: OpsPayload['agents'][number]['tokens1d']): OpsAgent['tokens1d'] {
  return value &&
    safeNumber(value.tokens) &&
    typeof value.complete === 'boolean' &&
    (value.complete || value.tokens > 0)
    ? { tokens: value.tokens, complete: value.complete }
    : null;
}

/** The page's board from one `ok` payload; a payload off the contract is a failed read. */
export function opsBoard(payload: OpsPayload): OpsBoard {
  if (
    !Array.isArray(payload.squads) ||
    !Array.isArray(payload.agents) ||
    payload.agents.some(
      (agent) =>
        !agent ||
        typeof agent.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(agent.id),
    )
  )
    return unavailableBoard('read_failed');
  return {
    defaultIdleAlertMs:
      safeNumber(payload.defaultIdleAlertMs) &&
      payload.defaultIdleAlertMs >= 300_000 &&
      payload.defaultIdleAlertMs <= 86_400_000
        ? payload.defaultIdleAlertMs
        : null,
    squads: payload.squads.map((squad) => ({
      name: squad.name,
      room:
        squad.room &&
        coreId(squad.room.roomId) &&
        Number.isSafeInteger(squad.room.revision) &&
        squad.room.revision > 0
          ? { roomId: squad.room.roomId, revision: squad.room.revision }
          : null,
      ...(squad.lead ? { lead: squad.lead.name } : {}),
      ...(typeof squad.idleAlertMs === 'number' && Number.isFinite(squad.idleAlertMs)
        ? { idleAlertMs: squad.idleAlertMs }
        : {}),
      ...(squad.attention && { attention: attention(squad.attention) }),
    })),
    agents: payload.agents.map((agent) => {
      const state = agentState(agent);
      return {
        id: agent.id,
        ...(agent.presence ? { presence: agent.presence } : {}),
        ...(agent.activity
          ? {
              activity: {
                state: agent.activity.state,
                ...(safeNumber(agent.activity.sinceMs) ? { sinceMs: agent.activity.sinceMs } : {}),
              },
            }
          : {}),
        name: agent.name,
        squad: agent.squad,
        role: agent.role,
        state,
        ...(agent.state ? { taskState: agent.state } : {}),
        ...(agent.stateTone && Object.hasOwn(TASK_TONES, agent.stateTone)
          ? { taskTone: TASK_TONES[agent.stateTone] }
          : {}),
        ...(agent.staleness === 'fresh' || agent.staleness === 'stale'
          ? { staleness: agent.staleness }
          : {}),
        ...(agent.task ? { task: agent.task } : {}),
        ...(agent.next ? { next: agent.next } : {}),
        ...(agent.pending ? { pending: agent.pending } : {}),
        ...(agent.model ? { model: agent.model } : {}),
        waitingOnYou: agent.waitingOnYou ?? 0,
        tokens1d: usage1d(agent.tokens1d),
        checklistCount: safeNumber(agent.checklistCount) ? agent.checklistCount : null,
      };
    }),
    schedules: Array.isArray(payload.timers)
      ? payload.timers.map((timer) => ({
          id: timer.id,
          state: timer.state === 'on' || timer.state === 'paused' ? timer.state : null,
          nextMs: timer.state === 'on' && safeNumber(timer.nextMs) ? timer.nextMs : null,
          squad: timer.squad,
          when: timer.scheduleText,
          what: timer.what ?? '',
          ...(timer.owner ? { owner: timer.owner } : {}),
        }))
      : null,
    truncated: payload.truncated === true,
  };
}

/** The board from an owner read's answer. */
export function boardFromAnswer(answer: OwnerReadAnswer<OpsPayload>): OpsBoard {
  if (answer.state === 'ok') return opsBoard(answer.payload);
  return unavailableBoard(answer.state === 'unavailable' ? answer.reason : answer.state);
}

/** The source the page reads: the owner's board through `x/-/ops`. */
export const opsSource: OpsSource = {
  async board(signal) {
    const answer = await ownerRead<OpsPayload>('ops', signal);
    // A browser no longer paired here keeps no unsent words for whoever pairs it next (#6757).
    if (answer.state === 'no-session') forgetDrafts();
    return boardFromAnswer(answer);
  },
};
