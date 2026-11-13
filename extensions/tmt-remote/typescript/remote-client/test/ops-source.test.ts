import { readFileSync } from 'node:fs';
import { expect, it } from 'vite-plus/test';
import { AGENT_STATES, boardFromAnswer, type OpsPayload } from '../src/ops-source.js';
import { ownerAnswer } from '../src/owner-reads.js';

const vectors = JSON.parse(
  readFileSync(new URL('../../../../../contracts/owner-reads-v1.json', import.meta.url), 'utf8'),
) as { cases: { name: string; target: string; expect: Record<string, unknown> }[] };
const ops = vectors.cases.filter((vector) => vector.target === 'ops');
const answer = (document: Record<string, unknown>) =>
  boardFromAnswer(ownerAnswer<OpsPayload>({ ...document, observedAtMs: 1 }));

it('turns the contract board into rows with uncoloured activity states', () => {
  const board = answer(ops[0]!.expect);
  expect(board.unavailable).toBeUndefined();
  const room = { roomId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 3 };
  const withRoom = structuredClone(ops[0]!.expect) as { squads: { room?: unknown }[] };
  withRoom.squads[0]!.room = room;
  expect(answer(withRoom).squads[0]!.room).toEqual(room);
  withRoom.squads[0]!.room = { ...room, revision: 0 };
  expect(answer(withRoom).squads[0]!.room).toBeNull();
  expect(answer({ ...ops[0]!.expect, defaultIdleAlertMs: 900_000 }).defaultIdleAlertMs).toBe(
    900_000,
  );
  expect(answer({ ...ops[0]!.expect, defaultIdleAlertMs: null }).defaultIdleAlertMs).toBeNull();
  expect(board.squads).toEqual([
    { name: 'tmt-core', room: null, lead: 'tmt-lead', idleAlertMs: 1_800_000 },
  ]);
  expect(board.defaultIdleAlertMs).toBeNull();
  const enriched = structuredClone(ops[0]!.expect) as unknown as OpsPayload;
  enriched.defaultIdleAlertMs = 1_200_000;
  const withFields = {
    ...enriched,
    agents: enriched.agents.map((agent) => ({
      ...agent,
      tokens1d: { tokens: 50, complete: false },
      checklistCount: 5,
    })),
    timers:
      enriched.timers?.map((timer) => ({ ...timer, state: 'paused' as const, nextMs: 123 })) ??
      null,
  };
  const mapped = answer(withFields as unknown as Record<string, unknown>);
  expect(mapped.defaultIdleAlertMs).toBe(1_200_000);
  expect(mapped.agents[0]!.tokens1d).toEqual({ tokens: 50, complete: false });
  expect(mapped.agents[0]!.checklistCount).toBe(5);
  for (const count of [null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '2']) {
    const malformed = structuredClone(withFields);
    (malformed.agents[0] as unknown as { checklistCount: unknown }).checklistCount = count;
    expect(
      answer(malformed as unknown as Record<string, unknown>).agents[0]!.checklistCount,
    ).toBeNull();
  }
  expect(mapped.schedules![0]!.nextMs).toBeNull();
  expect(mapped.schedules![0]!.state).toBe('paused');
  expect(board.agents).toEqual([
    {
      id: '00000000-0000-4000-8000-000000000001',
      presence: 'active',
      activity: { state: 'working' },
      name: 'tmt-lead',
      squad: 'tmt-core',
      role: 'lead',
      state: 'working',
      task: 'review',
      waitingOnYou: 0,
      tokens1d: null,
      checklistCount: 2,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      presence: 'offline',
      name: 'core-3',
      squad: 'tmt-core',
      role: 'member',
      // Offline wins over what it waits for; raw board text is not another state.
      state: 'offline',
      task: '#4325',
      next: 'contract',
      pending: 'approve the plan',
      model: 'sonnet',
      waitingOnYou: 2,
      tokens1d: null,
      checklistCount: 0,
    },
  ]);
  expect(board.schedules).toEqual([
    {
      id: 'c1',
      state: 'on',
      nextMs: 1792636500000,
      squad: 'tmt-core',
      when: 'cron 35 * * * *',
      what: 'Hourly pass',
      owner: 'tmt-core-pm',
    },
  ]);
  for (const agent of board.agents) expect(AGENT_STATES[agent.state].word).toBeTruthy();
  // The provider's activity decides; without one, the state the board was told shows; anything
  // else is unknown, and offline wins over both.
  const states = (agent: Record<string, unknown>) =>
    answer({
      ...ops[0]!.expect,
      agents: [{ ...(ops[0]!.expect.agents as object[])[0], presence: 'active', ...agent }],
    }).agents[0]!.state;
  expect(states({ activity: { state: 'idle' }, state: 'working' })).toBe('idle');
  expect(states({ activity: undefined, state: 'idle' })).toBe('idle');
  expect(states({ activity: undefined, state: 'working' })).toBe('working');
  for (const state of ['ended', 'blocked', 'needs-you', undefined])
    expect(states({ activity: undefined, state })).toBe('unknown');
  expect(states({ presence: 'offline', activity: { state: 'working' } })).toBe('offline');
});

it('maps legacy states to the four neutral labels', () => {
  expect(new Set(Object.values(AGENT_STATES).map((state) => state.word))).toEqual(
    new Set(['Working', 'Idle', 'Unknown', 'Offline']),
  );
  expect(Object.values(AGENT_STATES).every((state) => state.tone === 'neutral')).toBe(true);
});

it('keeps a failed schedule read apart from no timers, and an empty board ok', () => {
  const failed = ops.find((vector) => vector.name.includes('timers null'))!;
  expect(answer(failed.expect)).toEqual({
    squads: [],
    agents: [],
    schedules: null,
    defaultIdleAlertMs: null,
    truncated: false,
  });
  const empty = ops.find((vector) => vector.name.includes('no squads'))!;
  expect(answer(empty.expect)).toEqual({
    squads: [],
    agents: [],
    schedules: [],
    defaultIdleAlertMs: null,
    truncated: false,
  });
});

it('says why there is no board, with what to do, for every reason and no answer at all', () => {
  const texts = new Set<string>();
  for (const reason of [
    'not_installed',
    'core_unavailable',
    'timeout',
    'read_failed',
    'too_large',
    'later',
  ]) {
    const board = answer({ version: 1, state: 'unavailable', reason });
    expect(board).toMatchObject({ agents: [], squads: [], schedules: [] });
    texts.add(board.unavailable!);
  }
  // Only a browser the door names no owner mount for is asked to pair; a mount that did not
  // answer this time is retried, never a reason to pair again (#4018).
  expect(boardFromAnswer({ state: 'no-session' }).unavailable).toMatch(/Pair it from Remote/);
  const unreachable = boardFromAnswer({ state: 'unreachable' }).unavailable!;
  expect(unreachable).toBe('Your machine did not answer. This page tries again shortly.');
  expect(unreachable).not.toMatch(/[Pp]air/);
  // Each reason, an unknown one included, reads as its own sentence, never as an empty list.
  expect(texts.size).toBe(6);
  expect(answer({ version: 1, state: 'ok', squads: 'x', agents: [] }).unavailable).toMatch(
    /could not read/,
  );
});

it('keeps identity and plain-state evidence, and refuses missing or non-UUID member IDs', () => {
  const payload = structuredClone(ops[0]!.expect);
  const valid = answer(payload);
  expect(valid.agents[0]!.id).toBe('00000000-0000-4000-8000-000000000001');
  for (const id of [undefined, 'tmt-lead', 42]) {
    const malformed = structuredClone(payload) as { agents: { id?: unknown }[] };
    malformed.agents[0]!.id = id;
    expect(answer(malformed).unavailable).toMatch(/could not read/);
  }
});
