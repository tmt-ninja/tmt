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

const CHECK =
  /\nCheck it when done: tmt colab block props ([0-9a-f-]{36}) ([0-9a-f-]{36}) --set checked=true$/;

/** The request's to-do section, appended after the comment. */
export function todoSection(page: string, todo: AskTodo): string {
  return `\n\nTo-do: ${todo.text}\nCheck it when done: tmt colab block props ${page} ${todo.block} --set checked=true`;
}

/**
 * The to-do this page's own signed Ask named, read back from the message Colab composed. Only Colab
 * reads this section, for its own page; no other component may infer state from request text.
 */
export function askedTodo(page: string, message: string): AskTodo | undefined {
  const check = CHECK.exec(message);
  if (!check || check[1] !== page) return undefined;
  const head = message.slice(0, check.index);
  const at = head.lastIndexOf('\n\nTo-do: ');
  if (at < 0) return undefined;
  return { block: check[2]!, text: head.slice(at + '\n\nTo-do: '.length) };
}

const ROOT_PARENT = 'root';
export const ASKED_HEADING = 'Asked here';

/**
 * The ops that add an Ask's to-do: after the page's last top-level to-do, or under a new "Asked
 * here" heading at the end when the page has none. Nothing when the block exists, even deleted: a
 * to-do the person removed is never put back.
 */
export function todoInsertOps(
  blocks: Readonly<Record<string, import('./blocks.js').BlockEntry>>,
  todo: AskTodo,
  assignee: string,
  thread: string,
  headingId: string,
): import('./block-model.js').BlockOp[] {
  if (Object.hasOwn(blocks, todo.block)) return [];
  const top = Object.entries(blocks)
    .filter(([, block]) => block.parent === ROOT_PARENT && block.deleted === undefined)
    .sort(([a, x], [b, y]) => (x.pos < y.pos ? -1 : x.pos > y.pos ? 1 : a < b ? -1 : 1));
  const lastTodo = top.filter(([, block]) => block.type === 'todo').at(-1)?.[0];
  const props = { checked: false, assignee: assignee.slice(0, 128), thread };
  if (lastTodo)
    return [
      {
        op: 'insert',
        id: todo.block,
        type: 'todo',
        parent: ROOT_PARENT,
        after: lastTodo,
        props,
        text: todo.text,
      },
    ];
  const last = top.at(-1)?.[0] ?? null;
  return [
    {
      op: 'insert',
      id: headingId,
      type: 'heading',
      parent: ROOT_PARENT,
      after: last,
      props: { level: 2 },
      text: ASKED_HEADING,
    },
    {
      op: 'insert',
      id: todo.block,
      type: 'todo',
      parent: ROOT_PARENT,
      after: headingId,
      props,
      text: todo.text,
    },
  ];
}
