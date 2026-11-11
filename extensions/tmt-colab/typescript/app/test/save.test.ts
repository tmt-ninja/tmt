import { expect, it } from 'vite-plus/test';
import {
  BLOCK_STALE_RETRIES,
  blocksResult,
  canSendAgain,
  conflictAt,
  resendStale,
  saveMessage,
  saveResult,
  subpageBatchResult,
  SaveConflict,
  SaveNotApplied,
  SaveOutcomeUnknown,
  SaveRefused,
  settledAgainst,
  workResult,
} from '../src/save.js';
import { text } from '../src/strings.js';

const frame = (fields: Record<string, unknown>) => ({
  version: 1,
  type: 'saveresult',
  space: 's',
  page: 'p',
  epoch: '1',
  operationId: 'o',
  ...fields,
});
const DIGEST = 'A'.repeat(43);

it('admits only bounded ordered sub-page batch receipts', () => {
  const entry = {
    operationId: '60000000-0000-4000-8000-000000000001',
    state: 'committed',
    childPage: '60000000-0000-4000-8000-000000000002',
  };
  expect(
    subpageBatchResult(frame({ state: 'running', entries: [entry], nextIndex: 1 }), 'o'),
  ).toMatchObject({ state: 'running', entries: [entry], nextIndex: 1 });
  expect(subpageBatchResult(frame({ state: 'absent' }), 'o')).toMatchObject({
    state: 'absent',
    entries: [],
    nextIndex: 0,
  });
  expect(
    subpageBatchResult(
      frame({ state: 'committed', revision: 'v1:abc', entries: [entry], nextIndex: 1 }),
      'o',
    ),
  ).toMatchObject({ state: 'committed', entries: [entry] });
  expect(
    subpageBatchResult(
      frame({
        state: 'rejected',
        code: 'COLAB_STALE_BASE',
        entries: [entry],
        nextIndex: 1,
        childPage: '60000000-0000-4000-8000-000000000004',
      }),
      'o',
    ),
  ).toMatchObject({ state: 'rejected', code: 'COLAB_STALE_BASE', nextIndex: 1 });
  for (const bad of [
    { state: 'running', entries: [entry], nextIndex: 0 },
    { state: 'running', entries: [entry, entry], nextIndex: 2 },
    {
      state: 'running',
      entries: [entry, { ...entry, operationId: '60000000-0000-4000-8000-000000000003' }],
      nextIndex: 2,
    },
    { state: 'running', entries: [{ ...entry, childPage: 'bad' }], nextIndex: 1 },
    { state: 'running', entries: [{ ...entry, state: 'rejected' }], nextIndex: 1 },
    { state: 'absent', entries: [], nextIndex: 0 },
    { state: 'absent', childPage: entry.childPage },
    { state: 'committed', revision: 'v1:abc', entries: [], nextIndex: 0 },
    { state: 'committed', revision: 'v1:abc', entries: Array(129).fill(entry), nextIndex: 129 },
  ])
    expect(() => subpageBatchResult(frame(bad), 'o')).toThrow();
});

it('a merged commit names the source it holds, and only a commit may', () => {
  const merged = saveResult(
    frame({ state: 'committed', revision: 'v1:abc', merged: true, sourceSha256: DIGEST }),
    'o',
  );
  expect(merged).toMatchObject({ state: 'committed', merged: true, sourceSha256: DIGEST });
  expect(saveResult(frame({ state: 'committed', revision: 'v1:abc' }), 'o').merged).toBeUndefined();
  for (const broken of [
    { state: 'committed', revision: 'v1:abc', merged: true },
    { state: 'committed', revision: 'v1:abc', merged: false, sourceSha256: DIGEST },
    { state: 'committed', revision: 'v1:abc', merged: true, sourceSha256: 'short' },
    { state: 'committed', revision: 'v1:abc', sourceSha256: DIGEST },
    { state: 'unchanged', revision: 'v1:abc', merged: true, sourceSha256: DIGEST },
  ])
    expect(() => saveResult(frame(broken), 'o'), JSON.stringify(broken)).toThrow();
});

it('the conflicting hunks come only with a patch conflict, as ascending distinct indices', () => {
  const rejected = { state: 'rejected', code: 'COLAB_PATCH_CONFLICT', message: 'x' };
  expect(saveResult(frame({ ...rejected, conflicts: [0, 3] }), 'o').conflicts).toEqual([0, 3]);
  for (const conflicts of [[], [3, 0], [1, 1], [-1], [64], [0.5], 'a', [null]])
    expect(
      () => saveResult(frame({ ...rejected, conflicts }), 'o'),
      JSON.stringify(conflicts),
    ).toThrow();
  expect(() =>
    saveResult(frame({ state: 'rejected', code: 'COLAB_STALE_BASE', conflicts: [0] }), 'o'),
  ).toThrow();
  expect(() => saveResult(frame({ state: 'absent', conflicts: [0] }), 'o')).toThrow();
});

it('a conflict is named by the first changed line of its region that holds text, as inert text', () => {
  // The context above the change is not what changed: the quote is the line the editor edited.
  expect(
    conflictAt({
      oldStart: 10,
      old: 'a\nb\nc\nTotal: 4\ne\n',
      new: 'a\nb\nc\nTotal: 5\ne\n',
    }),
  ).toEqual({ line: 13, excerpt: 'Total: 4' });
  // An insertion is named by the line it goes before; one at the end by the last line.
  expect(conflictAt({ oldStart: 3, old: 'a\nb\n', new: 'a\nnew\nb\n' })).toEqual({
    line: 4,
    excerpt: 'b',
  });
  expect(conflictAt({ oldStart: 3, old: 'a\nb\n', new: 'a\nb\nnew\n' })).toEqual({
    line: 4,
    excerpt: 'b',
  });
  // Blank lines do not name a region: the next line with text does, with its own line number.
  expect(
    conflictAt({
      oldStart: 10,
      old: 'ctx\n\n  \n\t<p>Hi   there</p>\n',
      new: 'ctx\nZ\n  \n\t<p>Hi   there</p>\n',
    }),
  ).toEqual({ line: 13, excerpt: '<p>Hi there</p>' });
  // Control and bidi characters are removed, so a quote cannot reorder or hide the text around it.
  expect(
    conflictAt({ oldStart: 1, old: 'a\u202eb\u2066c\u200fd\u0007e\u061cf\n', new: '' }).excerpt,
  ).toBe('abcdef');
  // Clipped to 60 characters (not code units) with an ellipsis.
  const long = '🐈'.repeat(61);
  expect(conflictAt({ oldStart: 1, old: `${long}\n`, new: '' }).excerpt).toBe(
    `${'🐈'.repeat(60)}…`,
  );
  expect(conflictAt({ oldStart: 1, old: `${'x'.repeat(60)}\n`, new: '' }).excerpt).toBe(
    'x'.repeat(60),
  );
  // Nothing but blank lines: the line number alone.
  expect(conflictAt({ oldStart: 4, old: '\n\n', new: '' })).toEqual({ line: 4, excerpt: '' });
});

it('the conflict sentence names one edit or several, quoting the first', () => {
  const one = saveMessage(new SaveConflict(1, { line: 12, excerpt: 'Total: 4' }));
  expect(one).toBe(
    'Nothing was saved. Your edit near “Total: 4” (line 12) conflicts with a change made elsewhere. Your draft is kept. Copy it, reload for the latest source, then apply that part again.',
  );
  expect(saveMessage(new SaveConflict(3, { line: 12, excerpt: 'Total: 4' }))).toBe(
    'Nothing was saved. 3 of your edits conflict with changes made elsewhere, the first near “Total: 4” (line 12). Your draft is kept. Copy it, reload for the latest source, then apply those parts again.',
  );
  expect(saveMessage(new SaveConflict(1, { line: 4, excerpt: '' }))).toContain(
    'Your edit at line 4 conflicts',
  );
  expect(text.saveMerged).toBe('Saved. Your edit was merged with a change made elsewhere.');
});

it('a page that kept moving while its hunks were evaluated is still the stale-base sentence', () => {
  expect(saveMessage(new SaveRefused('COLAB_STALE_BASE', 'Moved.'))).toBe(text.saveStale);
  expect(saveMessage(new SaveRefused('COLAB_PATCH_CONFLICT', 'No match.'))).toBe('No match.');
});

it('a refusal that names hunks which no longer fit is the conflict the first one anchors', () => {
  const hunks = [
    { oldStart: 3, old: 'a\n', new: 'b\n' },
    { oldStart: 9, old: 'Total: 4\n', new: 'Total: 5\n' },
  ];
  const refused = (conflicts?: number[]) =>
    saveResult(
      frame({
        state: 'rejected',
        code: conflicts ? 'COLAB_PATCH_CONFLICT' : 'COLAB_STALE_BASE',
        message: 'The page changed.',
        ...(conflicts ? { conflicts } : {}),
      }),
      'o',
    );
  expect(() => settledAgainst(refused([1]), hunks)).toThrow(SaveConflict);
  try {
    settledAgainst(refused([1]), hunks);
  } catch (error) {
    expect((error as SaveConflict).count).toBe(1);
    expect((error as SaveConflict).first).toEqual(conflictAt(hunks[1]));
  }
  // Without conflicts named, or when the save sent no hunks, the refusal is the refusal.
  expect(() => settledAgainst(refused(), hunks)).toThrow(SaveRefused);
  expect(() => settledAgainst(refused([1]))).toThrow(SaveRefused);
  // A commit passes through untouched.
  const committed = saveResult(frame({ state: 'committed', revision: '7' }), 'o');
  expect(settledAgainst(committed, hunks)).toBe(committed);
});

it('a work reply is a save reply, with no task ID', () => {
  const reply = (fields: Record<string, unknown>) => ({ ...frame(fields), type: 'workresult' });
  expect(workResult(reply({ state: 'committed', revision: 'v1:abc' }), 'o')).toMatchObject({
    state: 'committed',
    revision: 'v1:abc',
  });
  expect(
    workResult(
      reply({ state: 'rejected', code: 'COLAB_LINK_REFUSED', reason: 'second-parent' }),
      'o',
    ),
  ).toMatchObject({ state: 'rejected', code: 'COLAB_LINK_REFUSED', reason: 'second-parent' });
  for (const broken of [
    // The task-era result field is gone.
    { state: 'committed', revision: 'v1:abc', taskId: 'T-12' },
    { state: 'committed', revision: 'v1:abc', extra: true },
  ])
    expect(() => workResult(reply(broken), 'o'), JSON.stringify(broken)).toThrow();
  expect(() => workResult(reply({ state: 'committed', revision: 'v1:abc' }), 'other')).toThrow();
});

it('a create names the page it made in every final outcome, and nowhere else', () => {
  const page = '20000000-0000-4000-8000-000000000009';
  const reply = (fields: Record<string, unknown>) => ({ ...frame(fields), type: 'workresult' });
  expect(
    workResult(reply({ state: 'committed', revision: 'v1:abc', childPage: page }), 'o'),
  ).toMatchObject({ state: 'committed', childPage: page });
  // A made page whose link did not land: rejected with the page, or absent with the page.
  const refused = workResult(
    reply({ state: 'rejected', code: 'COLAB_LINK_REFUSED', childPage: page }),
    'o',
  );
  expect(() => settledAgainst(refused)).toThrow(SaveRefused);
  try {
    settledAgainst(refused);
  } catch (error) {
    expect((error as SaveRefused).childPage).toBe(page);
  }
  const absent = saveResult(frame({ state: 'absent', childPage: page }), 'o');
  try {
    settledAgainst(absent);
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(SaveNotApplied);
    expect((error as SaveNotApplied).childPage).toBe(page);
  }
  for (const broken of [
    { state: 'unchanged', revision: 'v1:abc', childPage: page },
    { state: 'pending', childPage: page },
    { state: 'committed', revision: 'v1:abc', childPage: 'not-an-id' },
    { state: 'committed', revision: 'v1:abc', childPage: 7 },
    { state: 'committed', revision: 'v1:abc', childPage: page.replace('-4000-', '-1000-') },
  ])
    expect(() => saveResult(frame(broken), 'o'), JSON.stringify(broken)).toThrow();
});

it('keeps bounded line-specific question repairs alongside a short Save refusal', () => {
  const findings = [
    {
      code: 'COLAB_QUESTION_UNREGISTERED',
      line: 7,
      fix: 'tmt colab question add PAGE --id UUID --agent NAME',
    },
  ];
  const result = saveResult(
    frame({
      state: 'rejected',
      code: findings[0].code,
      message: 'Register the question.',
      findings,
    }),
    'o',
  );
  expect(result.findings).toEqual(findings);
  try {
    settledAgainst(result);
    throw new Error('Save must refuse');
  } catch (error) {
    expect(error).toBeInstanceOf(SaveRefused);
    expect(saveMessage(error)).toContain(findings[0].fix);
  }
  for (const invalid of [
    [],
    Array(51).fill(findings[0]),
    [{ ...findings[0], line: 0 }],
    [{ ...findings[0], code: 'OTHER' }],
    [{ ...findings[0], fix: 'x'.repeat(2049) }],
    [{ ...findings[0], fix: 'line\nbreak' }],
    [{ ...findings[0], extra: true }],
  ])
    expect(() =>
      saveResult(frame({ state: 'rejected', code: findings[0].code, findings: invalid }), 'o'),
    ).toThrow();
  expect(() =>
    saveResult(frame({ state: 'committed', revision: 'v1:abc', findings }), 'o'),
  ).toThrow();
});

it('keeps stable link refusal reasons through parsing and settlement', () => {
  const reply = (fields: Record<string, unknown>) => ({ ...frame(fields), type: 'workresult' });
  for (const reason of ['second-parent', 'cycle', 'invalid-hierarchy', 'unavailable']) {
    const result = workResult(
      reply({ state: 'rejected', code: 'COLAB_LINK_REFUSED', message: 'Repair the link', reason }),
      'o',
    );
    expect(result).toMatchObject({ reason });
    try {
      settledAgainst(result);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SaveRefused);
      expect(error).toMatchObject({ reason });
    }
  }
  // Replies from an older owner remain readable.
  expect(
    workResult(reply({ state: 'rejected', code: 'COLAB_LINK_REFUSED' }), 'o'),
  ).not.toHaveProperty('reason');
  for (const fields of [
    { state: 'rejected', code: 'COLAB_LINK_REFUSED', reason: 'unknown' },
    // The one-level rule is gone (#5820); its reasons are no longer part of the contract.
    { state: 'rejected', code: 'COLAB_LINK_REFUSED', reason: 'child-has-parent' },
    { state: 'rejected', code: 'COLAB_LINK_REFUSED', reason: 'parent-has-children' },
    { state: 'rejected', code: 'COLAB_LINK_REFUSED', reason: 7 },
    { state: 'rejected', code: 'COLAB_INPUT_INVALID', reason: 'cycle' },
    { state: 'committed', revision: 'v1:abc', reason: 'cycle' },
  ])
    expect(() => workResult(reply(fields), 'o')).toThrow();
});

it('a block batch reply carries its receipt, and nothing else beyond a save reply', () => {
  const receipt = {
    ops: [{ op: 'text', id: 'b1' }],
    droppedHunks: [{ id: 'b1', from: 4, to: 7, text: 'dog' }],
  };
  expect(
    blocksResult(
      frame({ type: 'blocksresult', state: 'committed', revision: 'v1:a', receipt }),
      'o',
    ),
  ).toEqual({ operationId: 'o', state: 'committed', revision: 'v1:a', receipt });
  // A batch with an attachment change (#6190) lists the IDs it set and removed.
  const listed = {
    ...receipt,
    attachments: { set: ['abf35c90-ff8f-4c23-b838-a63da7c2b63f'], remove: [] },
  };
  expect(
    blocksResult(
      frame({ type: 'blocksresult', state: 'committed', revision: 'v1:a', receipt: listed }),
      'o',
    ).receipt,
  ).toEqual(listed);
  // A refusal before the batch reached the page has no receipt.
  expect(
    blocksResult(
      frame({ type: 'blocksresult', state: 'rejected', code: 'COLAB_BLOCK_BAD_AFTER' }),
      'o',
    ),
  ).toEqual({ operationId: 'o', state: 'rejected', code: 'COLAB_BLOCK_BAD_AFTER' });
  for (const bad of [
    { ...receipt, extra: 1 },
    { ...receipt, attachments: { set: [] } },
    { ...receipt, attachments: { set: [7], remove: [] } },
    { ...receipt, attachments: { set: [], remove: [], kept: [] } },
    { ops: [{ op: 'text', id: 'b1', pos: 'a' }], droppedHunks: [] },
    { ops: [], droppedHunks: [{ id: 'b1', from: 5, to: 4, text: '' }] },
  ])
    expect(() =>
      blocksResult(
        frame({ type: 'blocksresult', state: 'committed', revision: 'v1:a', receipt: bad }),
        'o',
      ),
    ).toThrow();
});

// #6220: a block batch the page moved under (the serve's stale refusal, nothing written) is sent
// again; nothing else is.
const stale = () => new SaveRefused('COLAB_STALE_BASE', 'Page changed since the editing base.');
/** A send that fails as `fail()` for its first `failures` calls and then resolves with the call count. */
function sends(fail: () => Error, failures: number) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    send: async () => {
      calls++;
      if (calls <= failures) throw fail();
      return calls;
    },
  };
}

it('sends a batch again after a stale refusal, up to three more times', async () => {
  const once = sends(stale, 1);
  expect(await resendStale(once.send)).toBe(2);
  expect(once.calls).toBe(2);
  const last = sends(stale, BLOCK_STALE_RETRIES);
  expect(await resendStale(last.send)).toBe(BLOCK_STALE_RETRIES + 1);
});

it('gives the stale refusal of the last attempt to the caller', async () => {
  const always = sends(stale, Infinity);
  await expect(resendStale(always.send)).rejects.toMatchObject({ code: 'COLAB_STALE_BASE' });
  expect(always.calls).toBe(BLOCK_STALE_RETRIES + 1);
});

it('never sends again after an outcome in doubt, a timeout or another refusal', async () => {
  for (const fail of [
    () => new SaveOutcomeUnknown('o'),
    () => new SaveNotApplied('o'),
    () => new SaveRefused('COLAB_BLOCK_NOT_FOUND', 'That block no longer exists.'),
    () => new SaveRefused('COLAB_CAPACITY', 'The page is full.'),
    () => new Error('Timed out'),
  ]) {
    const refused = sends(fail, Infinity);
    await expect(resendStale(refused.send)).rejects.toBeInstanceOf(Error);
    expect(refused.calls).toBe(1);
  }
});

// #6227: Retry is offered only for a refusal that a new send can get past. A code is listed on
// purpose: a new one is refused the same way each time until someone decides otherwise.
it('offers to send a refused batch again only for a refusal that can pass', () => {
  const refused = (code: string) => new SaveRefused(code, 'Refused.');
  for (const code of ['COLAB_STALE_BASE', 'COLAB_STREAM_GAP', 'COLAB_UNAVAILABLE'])
    expect(canSendAgain(refused(code)), code).toBe(true);
  for (const code of [
    'COLAB_BLOCK_NOT_FOUND',
    'COLAB_BLOCK_BAD_AFTER',
    'COLAB_BLOCK_MARKUP',
    'COLAB_CAPACITY',
    'COLAB_DENIED',
    'COLAB_INPUT_INVALID',
    'COLAB_INVALID',
    'COLAB_OPERATION_CONFLICT',
    'COLAB_PAGE_INACTIVE',
    'COLAB_STATE_MISSING',
  ])
    expect(canSendAgain(refused(code)), code).toBe(false);
});
