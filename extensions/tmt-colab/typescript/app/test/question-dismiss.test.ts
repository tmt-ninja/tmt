import { expect, it, vi } from 'vite-plus/test';
import { QuestionDismissal } from '../src/question-dismiss.js';

it('keeps a removed block removed when handle fails and retries only handle', async () => {
  const edit = vi.fn().mockResolvedValue(undefined);
  const handle = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const reopen = vi.fn();
  const dismissal = new QuestionDismissal({ edit, handle, reopen });
  await dismissal.dismiss('before', 'after', true);
  expect(dismissal.state).toBe('handle-failed');
  expect(edit).toHaveBeenCalledTimes(1);
  await dismissal.retry();
  expect(dismissal.state).toBe('removed');
  expect(edit).toHaveBeenCalledTimes(1);
  expect(handle).toHaveBeenCalledTimes(2);
  expect(reopen).not.toHaveBeenCalled();
});

it('keeps an undone block restored when reopen fails and retries only reopen', async () => {
  const edit = vi.fn().mockResolvedValue(undefined);
  const handle = vi.fn().mockResolvedValue(undefined);
  const reopen = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const dismissal = new QuestionDismissal({ edit, handle, reopen });
  await dismissal.dismiss('before', 'after', true);
  await dismissal.undo();
  expect(dismissal.state).toBe('reopen-failed');
  expect(edit).toHaveBeenCalledTimes(2);
  await dismissal.retry();
  expect(dismissal.state).toBe('restored');
  expect(edit).toHaveBeenCalledTimes(2);
  expect(reopen).toHaveBeenCalledTimes(2);
});

it('reads an unknown handle outcome before treating the already-handled state as success', async () => {
  const { SaveOutcomeUnknown } = await import('../src/save.js');
  const handle = vi.fn().mockRejectedValue(new SaveOutcomeUnknown('operation'));
  const readHandled = vi.fn().mockResolvedValue(true);
  const reopen = vi.fn().mockResolvedValue(undefined);
  const dismissal = new QuestionDismissal({
    edit: vi.fn().mockResolvedValue(undefined),
    handle,
    reopen,
    readHandled,
  });
  await dismissal.dismiss('before', 'after', true);
  expect(dismissal.state).toBe('removed');
  expect(readHandled).toHaveBeenCalledTimes(1);
  await dismissal.undo();
  expect(reopen).toHaveBeenCalledTimes(1);
});

it('Undo reopens a previously open question even when handle failed', async () => {
  const reopen = vi.fn().mockResolvedValue(undefined);
  const dismissal = new QuestionDismissal({
    edit: vi.fn().mockResolvedValue(undefined),
    handle: vi.fn().mockRejectedValue(new Error('offline')),
    reopen,
  });
  await dismissal.dismiss('before', 'after', true);
  await dismissal.undo();
  expect(dismissal.state).toBe('restored');
  expect(reopen).toHaveBeenCalledTimes(1);
});
