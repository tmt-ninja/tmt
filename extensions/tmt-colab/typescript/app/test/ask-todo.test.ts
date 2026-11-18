import { expect, it } from 'vite-plus/test';
import { askedTodo, todoBlockId, todoInsertOps, todoSection, todoText } from '../src/ask-todo.js';
import { askTodoProgress } from '../src/ask-todo-line.js';
import type { PageAsk } from '../src/ask-panel.js';
import type { BlockEntry } from '../src/blocks.js';

const page = '10000000-0000-4000-8000-000000000001';
const thread = '20000000-0000-4000-8000-000000000002';

it('derives one generated-shape to-do ID per page and thread, so a retried Ask names the same to-do', async () => {
  const id = await todoBlockId(page, thread);
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(await todoBlockId(page, thread)).toBe(id);
  expect(await todoBlockId(page, '20000000-0000-4000-8000-000000000003')).not.toBe(id);
});

it('takes the comment first line as the to-do text, cut on a character boundary', () => {
  expect(todoText('\n  @gui-3 fix the toolbar gap  \nmore detail')).toBe(
    '@gui-3 fix the toolbar gap',
  );
  expect(new TextEncoder().encode(todoText('界'.repeat(200))).length).toBeLessThanOrEqual(256);
  expect(todoText('界'.repeat(200))).toBe('界'.repeat(85));
});

it('reads back only the to-do this page named, from the section Colab composed', () => {
  const todo = { block: '30000000-0000-4000-8000-000000000003', text: 'Fix the gap' };
  const message = `Page: P\nLink: L\n\nQuote:\nq\n\nComment:\n@gui-3 fix it${todoSection(page, todo)}`;
  expect(message).toContain(`tmt colab block props ${page} ${todo.block} --set checked=true`);
  expect(askedTodo(page, message)).toEqual(todo);
  expect(askedTodo('10000000-0000-4000-8000-000000000009', message)).toBeUndefined();
  expect(askedTodo(page, 'Comment:\nno to-do here')).toBeUndefined();
});

const block = (
  type: string,
  pos: string,
  props: Record<string, unknown> = {},
  deleted?: number,
): BlockEntry => ({
  type,
  parent: 'root',
  pos,
  props,
  ...(deleted === undefined ? {} : { deleted }),
});

it('adds the to-do after the last to-do, else under a new heading, and never twice or back', () => {
  const todo = { block: '30000000-0000-4000-8000-000000000003', text: 'Fix the gap' };
  const withTodos = {
    a: block('paragraph', 'a'),
    b: block('todo', 'b'),
    c: block('todo', 'c'),
    d: block('paragraph', 'd'),
  };
  expect(todoInsertOps(withTodos, todo, 'gui-3', thread, 'h')).toEqual([
    {
      op: 'insert',
      id: todo.block,
      type: 'todo',
      parent: 'root',
      after: 'c',
      props: { checked: false, assignee: 'gui-3', thread },
      text: 'Fix the gap',
    },
  ]);
  const plain = { a: block('paragraph', 'a'), d: block('paragraph', 'd') };
  const ops = todoInsertOps(plain, todo, 'gui-3', thread, 'h');
  expect(ops.map((op) => [op.op === 'insert' && op.type, op.op === 'insert' && op.after])).toEqual([
    ['heading', 'd'],
    ['todo', 'h'],
  ]);
  expect(
    todoInsertOps({ ...plain, [todo.block]: block('todo', 'z') }, todo, 'gui-3', thread, 'h'),
  ).toEqual([]);
  expect(
    todoInsertOps(
      { ...plain, [todo.block]: block('todo', 'z', {}, 1) },
      todo,
      'gui-3',
      thread,
      'h',
    ),
  ).toEqual([]);
});

it('says under the comment whether its to-do is done, answered, in progress or open', () => {
  const blocks = {
    t: block('todo', 't', { thread, assignee: 'gui-3', checked: false }),
  };
  const ask = (extra: Partial<PageAsk>) => ({ thread, state: 'accepted', ...extra }) as PageAsk;
  expect(askTodoProgress(blocks, { t: 'COLAB-140-3' }, [ask({})]).get(thread)).toEqual({
    assignee: 'gui-3',
    state: 'in-progress',
    number: 'COLAB-140-3',
  });
  expect(askTodoProgress(blocks, undefined, [ask({ reply: 'Done it' })]).get(thread)?.state).toBe(
    'answered',
  );
  // A reader has no Ask state and no number: the page data alone.
  expect(askTodoProgress(blocks, undefined, []).get(thread)).toEqual({
    assignee: 'gui-3',
    state: 'open',
  });
  const checked = { t: block('todo', 't', { thread, assignee: 'gui-3', checked: true }) };
  expect(askTodoProgress(checked, undefined, []).get(thread)?.state).toBe('done');
});
