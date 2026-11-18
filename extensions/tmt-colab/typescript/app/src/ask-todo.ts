/**
 * A comment that asks an agent becomes a to-do on its block page (#6474, spec 隨口交辦).
 *
 * The asking browser picks the to-do's block ID before Send, from the page and the comment thread,
 * so a retried Ask of the same thread names the same to-do and never makes a second one. The
 * request text names the page, that block ID and the to-do text: the exact `tmt colab block props`
 * call that checks it. Only after Remote's settled send outcome (`accepted`) does the page insert
 * the block; its work number is issued by the ordinary publish. Done is the to-do being checked.
 */

export const TODO_TEXT_BYTES = 256;

/** A UUID-v4-shaped ID derived from the page and the thread: the same Ask thread, the same to-do. */
export async function todoBlockId(page: string, thread: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`colab-ask-todo\n${page}\n${thread}`),
    ),
  ).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x40;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The to-do's text: the comment's first non-empty line without the leading mention of the asked
 * agent, spaces collapsed, cut on a character boundary. */
export function todoText(comment: string, agent?: string): string {
  // The mention that asked the agent is who the to-do is for, not what it says.
  const mention = agent ? `@${agent}` : undefined;
  const line = comment
    .split('\n')
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .map((value) =>
      mention && value.startsWith(mention) && /^(\s|$)/.test(value.slice(mention.length))
        ? value.slice(mention.length).trim()
        : value,
    )
    .find((value) => value.length > 0);
  let out = '';
  let bytes = 0;
  for (const point of line ?? '') {
    const size = new TextEncoder().encode(point).length;
    if (bytes + size > TODO_TEXT_BYTES) break;
    out += point;
    bytes += size;
  }
  return out;
}

export interface AskTodo {
  block: string;
  text: string;
}

/** The request's to-do section, appended after the comment. */
export function todoSection(page: string, todo: AskTodo): string {
  return `\n\nTo-do: ${todo.text}\nCheck it when done: tmt colab block props ${page} ${todo.block} --set checked=true`;
}

/**
 * The to-do an accepted Ask became, derived from its record, never read out of its text: the block
 * ID from the page and the Ask's signed thread, the text from the verified comment it names. The
 * signed message must end with exactly that section, so an Ask sent without one (an answer batch,
 * a status notification, a page of HTML) or a comment that writes a look-alike line adds nothing.
 */
export async function askTodoFrom(
  page: string,
  ask: { thread: string; message: string; agentName: string },
  comment: string | undefined,
): Promise<AskTodo | undefined> {
  if (comment === undefined) return undefined;
  const todo = {
    block: await todoBlockId(page, ask.thread),
    text: todoText(comment, ask.agentName),
  };
  return todo.text && ask.message.endsWith(todoSection(page, todo)) ? todo : undefined;
}

const ROOT_PARENT = 'root';

/**
 * The ops that add an Ask's to-do. An Ask anchored to a block puts it right after that block, after
 * any to-dos earlier Asks on it already added, so it belongs to that block's section (#6636). An Ask
 * with no live block anchor (page Chat) puts it after the page's last top-level to-do, or as the
 * page's last block when it has none. Nothing else is written into the person's page. Nothing when
 * the block exists, even deleted: a to-do the person removed is never put back.
 */
export function todoInsertOps(
  blocks: Readonly<Record<string, import('./blocks.js').BlockEntry>>,
  todo: AskTodo,
  assignee: string,
  thread: string,
  anchor?: string,
): import('./block-model.js').BlockOp[] {
  if (Object.hasOwn(blocks, todo.block)) return [];
  const siblings = (parent: string) =>
    Object.entries(blocks)
      .filter(([, block]) => block.parent === parent && block.deleted === undefined)
      .sort(([a, x], [b, y]) => (x.pos < y.pos ? -1 : x.pos > y.pos ? 1 : a < b ? -1 : 1));
  const anchored = anchor === undefined ? undefined : blocks[anchor];
  let parent = ROOT_PARENT;
  let after: string | null;
  if (anchored && anchored.deleted === undefined) {
    parent = anchored.parent;
    const row = siblings(parent);
    let at = row.findIndex(([id]) => id === anchor);
    while (row[at + 1]?.[1].type === 'todo' && typeof row[at + 1]![1].props.thread === 'string')
      at++;
    after = row[at]![0];
  } else {
    const top = siblings(ROOT_PARENT);
    after = top.filter(([, block]) => block.type === 'todo').at(-1)?.[0] ?? top.at(-1)?.[0] ?? null;
  }
  return [
    {
      op: 'insert',
      id: todo.block,
      type: 'todo',
      parent,
      after,
      props: { checked: false, assignee: assignee.slice(0, 128), thread },
      text: todo.text,
    },
  ];
}
