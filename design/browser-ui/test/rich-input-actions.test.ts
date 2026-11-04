import { expect, it, vi } from 'vite-plus/test';
import { notifyChipRemoval, chooseSuggestion } from '../src/rich-input/actions.js';

it('reports removed chips with the resulting value but ignores an unchanged chip moved by typing', () => {
  const before = {
    value: 'project:design ',
    chips: [{ kind: 'project', text: 'project:design', range: { start: 0, end: 14 } }],
  };
  const moved = {
    value: 'x project:design ',
    chips: [{ kind: 'project', text: 'project:design', range: { start: 2, end: 16 } }],
  };
  const empty = { value: '', chips: [] };
  const notify = vi.fn();
  notifyChipRemoval(before, moved, notify);
  expect(notify).not.toHaveBeenCalled();
  notifyChipRemoval(before, empty, notify);
  expect(notify).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledWith(empty);
});

it('lets the host handle a suggestion as an action and otherwise retains chip insertion', () => {
  const value = { value: '', chips: [] };
  const choice = vi.fn((kind: string) => kind === 'stage');
  expect(chooseSuggestion(choice, 'stage', { text: 'stage:done', label: 'Done' }, value)).toBe(
    true,
  );
  expect(choice).toHaveBeenCalledWith('stage', { text: 'stage:done', label: 'Done' }, value);
  expect(chooseSuggestion(choice, 'project', { text: 'project:design' }, value)).toBe(false);
  expect(chooseSuggestion(undefined, 'project', { text: 'project:design' }, value)).toBe(false);
});
