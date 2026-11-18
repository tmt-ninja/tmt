import { createContext, useContext } from 'react';
import type { PageAsk } from './ask-panel.js';
import type { BlockEntry } from './blocks.js';
import { text } from './strings.js';

const t = text.askTodo;

/** What the line under an Ask's comment says about the to-do it became (#6474, spec 隨口交辦). */
export interface AskTodoProgress {
  assignee: string;
  state: 'done' | 'answered' | 'in-progress' | 'open';
  /** The to-do's work number, owner-local; absent to readers. */
  number?: string;
}

/**
 * Each comment thread's to-do, from the page's own blocks: a to-do whose `thread` names the thread.
 * Done is the to-do checked. Otherwise the owner sees the thread's Ask (answered, or in progress
 * once sent); a reader, who has no Ask state, sees it open.
 */
export function askTodoProgress(
  blocks: Readonly<Record<string, BlockEntry>> | undefined,
  numbers: Readonly<Record<string, string>> | undefined,
  asks: readonly PageAsk[],
): ReadonlyMap<string, AskTodoProgress> {
  const progress = new Map<string, AskTodoProgress>();
  for (const [id, block] of Object.entries(blocks ?? {})) {
    const thread = block.props.thread;
    if (block.type !== 'todo' || block.deleted !== undefined || typeof thread !== 'string')
      continue;
    const asked = asks.filter((ask) => ask.thread === thread && ask.state === 'accepted');
    const assignee = typeof block.props.assignee === 'string' ? block.props.assignee : '';
    progress.set(thread, {
      assignee,
      state:
        block.props.checked === true
          ? 'done'
          : asked.some((ask) => ask.reply !== undefined)
            ? 'answered'
            : asked.length
              ? 'in-progress'
              : 'open',
      ...(numbers?.[id] ? { number: numbers[id] } : {}),
    });
  }
  return progress;
}

export const AskTodoContext = createContext<ReadonlyMap<string, AskTodoProgress>>(new Map());

export function AskTodoLine({ thread }: { thread: string }) {
  const progress = useContext(AskTodoContext).get(thread);
  if (!progress) return null;
  return (
    <p className="ask-todo-line" data-state={progress.state}>
      {[t.added, progress.assignee, t.state[progress.state], progress.number]
        .filter(Boolean)
        .join(' · ')}
    </p>
  );
}
