/** A page of blocks as HTML, for export (#6004): the document's live blocks in order, one
 * deterministic rendering. Mirrors the native `blocks::html`; both run
 * `contracts/vectors/blocks-html-v1.json` and agree byte for byte. Deleted blocks and what is
 * under them are left out; siblings come in `(pos, id)` order; adjacent list and to-do items form
 * one nested list. Everything authored is escaped; a mockup's markup is written as stored. */

type Json = Record<string, unknown>;
type Entry = [id: string, block: Json];

const MARKS = ['link', 'bold', 'italic', 'code', 'agent', 'block'] as const;

export function escape(value: string): string {
  let out = '';
  for (const c of value) {
    out +=
      c === '&'
        ? '&amp;'
        : c === '<'
          ? '&lt;'
          : c === '>'
            ? '&gt;'
            : c === '"'
              ? '&quot;'
              : c === "'"
                ? '&#39;'
                : c;
  }
  return out;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const obj = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};

/** The text of a `{s, marks}` value with its inline marks as tags; line feeds become `<br>`. */
function rich(value: unknown): string {
  const v = obj(value);
  const text = Array.from(str(v.s) ?? '');
  const marks = arr(v.marks).map(obj);
  const cuts = new Set<number>([0, text.length]);
  for (const mark of marks) {
    for (const key of ['from', 'to'] as const) {
      const at = mark[key];
      if (typeof at === 'number') cuts.add(Math.min(at, text.length));
    }
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  let out = '';
  for (let i = 0; i + 1 < sorted.length; i++) {
    const from = sorted[i]!;
    const to = sorted[i + 1]!;
    const covering = (name: string) =>
      marks.find(
        (mark) =>
          mark.mark === name &&
          typeof mark.from === 'number' &&
          mark.from <= from &&
          typeof mark.to === 'number' &&
          mark.to >= to,
      );
    let open = '';
    let close = '';
    for (const name of MARKS) {
      const mark = covering(name);
      if (!mark) continue;
      const value = escape(str(mark.value) ?? '');
      const [start, end] =
        name === 'link'
          ? [`<a href="${value}">`, '</a>']
          : name === 'bold'
            ? ['<strong>', '</strong>']
            : name === 'italic'
              ? ['<em>', '</em>']
              : name === 'code'
                ? ['<code>', '</code>']
                : name === 'agent'
                  ? [`<span data-agent="${value}">`, '</span>']
                  : [`<span data-block="${value}">`, '</span>'];
      open += start;
      close = end + close;
    }
    out += open + escape(text.slice(from, to).join('')).replaceAll('\n', '<br>') + close;
  }
  return out;
}

const plain = (value: unknown): string => escape(str(obj(value).s) ?? '').replaceAll('\n', '<br>');

function liveChildren(all: Json, parent: string): Entry[] {
  const items: Entry[] = Object.entries(all)
    .map(([id, b]): Entry => [id, obj(b)])
    .filter(([, b]) => b.parent === parent && b.deleted === undefined);
  items.sort(([ia, a], [ib, b]) => {
    const pa = str(a.pos) ?? '';
    const pb = str(b.pos) ?? '';
    return pa < pb ? -1 : pa > pb ? 1 : ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  return items;
}

const isItem = (block: Json) => block.type === 'list' || block.type === 'todo';

function item(block: Json): string {
  const props = obj(block.props);
  if (block.type !== 'todo') return rich(block.text);
  const mark = props.checked === true ? '☑' : '☐';
  const note: string[] = [];
  const who = str(props.assignee);
  if (who !== undefined) note.push(escape(who));
  const due = str(props.due);
  if (due !== undefined) note.push(`due ${escape(due)}`);
  return `${mark} ${rich(block.text)}${note.length === 0 ? '' : ` (${note.join(', ')})`}`;
}

/** Adjacent items as nested `ul`/`ol`: each level takes its first item's kind. */
function listRun(run: Entry[]): string {
  let out = '';
  const open: string[] = [];
  for (const [, block] of run) {
    const props = obj(block.props);
    const indent = typeof props.indent === 'number' ? props.indent : 0;
    const depth = Math.min(indent, 2);
    const tag = block.type === 'list' && props.style === 'number' ? 'ol' : 'ul';
    while (open.length > depth + 1) out += `</li></${open.pop()}>`;
    if (open.length === depth + 1) {
      if (open[depth] === tag) {
        out += '</li>';
      } else {
        out += `</li></${open[depth]}><${tag}>`;
        open[depth] = tag;
      }
    }
    while (open.length < depth + 1) {
      out += `<${tag}>`;
      open.push(tag);
    }
    out += `<li>${item(block)}`;
  }
  for (let tag = open.pop(); tag !== undefined; tag = open.pop()) out += `</li></${tag}>`;
  return `${out}\n`;
}

function table(all: Json, id: string, block: Json): string {
  const props = obj(block.props);
  const columns = arr(props.columns).map(obj);
  let out = '<table>';
  const label = str(props.label);
  if (label !== undefined) out += `<caption>${escape(label)}</caption>`;
  if (props.header !== false && columns.length > 0) {
    out += '<thead><tr>';
    for (const column of columns) out += `<th>${escape(str(column.name) ?? '')}</th>`;
    out += '</tr></thead>';
  }
  out += '<tbody>';
  for (const [, row] of liveChildren(all, id)) {
    out += '<tr>';
    const cells = obj(row.cells);
    for (const column of columns) {
      const key = str(column.id);
      const cell = key !== undefined && key in cells ? rich(cells[key]) : '';
      out += `<td>${cell}</td>`;
    }
    out += '</tr>';
  }
  return `${out}</tbody></table>\n`;
}

function render1(all: Json, id: string, block: Json): string {
  const props = obj(block.props);
  switch (block.type) {
    case 'paragraph':
      return `<p>${rich(block.text)}</p>\n`;
    case 'heading': {
      const level = props.level === 3 ? 3 : 2;
      return `<h${level}>${rich(block.text)}</h${level}>\n`;
    }
    case 'table':
      return table(all, id, block);
    case 'card': {
      const title = str(props.title);
      const meta = str(props.meta);
      const collapsible = props.collapsible === true;
      let out = '';
      if (collapsible) {
        out += `<details${props.collapsed === true ? '' : ' open'}>`;
        out += `<summary>${title === undefined ? '' : escape(title)}</summary>`;
      } else {
        out += '<section>';
        if (title !== undefined) out += `<h3>${escape(title)}</h3>`;
      }
      if (meta !== undefined) out += `<p><small>${escape(meta)}</small></p>`;
      out += '\n';
      out += children(all, id);
      return out + (collapsible ? '</details>\n' : '</section>\n');
    }
    case 'question': {
      const choices = arr(props.choices);
      const kind = str(props.kind) ?? (choices.length === 0 ? 'short' : 'single');
      let out = `<tmt-question data-id="${escape(id)}" data-kind="${escape(kind)}"`;
      const agent = str(props.agent);
      if (agent !== undefined) out += ` data-agent="${escape(agent)}"`;
      out += `><p data-question>${plain(block.text)}</p>`;
      for (const choice of choices) out += `<span data-choice>${escape(str(choice) ?? '')}</span>`;
      return `${out}</tmt-question>\n`;
    }
    case 'callout': {
      let out = '<aside';
      const tone = str(props.tone);
      if (tone !== undefined) out += ` data-tone="${escape(tone)}"`;
      out += '>';
      const label = str(props.label);
      const heading = str(props.heading);
      const parts = [
        ...(label === undefined ? [] : [`<strong>${escape(label)}</strong>`]),
        ...(heading === undefined ? [] : [escape(heading)]),
      ];
      if (parts.length > 0) out += `<p>${parts.join(' ')}</p>`;
      return `${out}<p>${rich(block.text)}</p></aside>\n`;
    }
    case 'code': {
      let out = '<pre';
      const name = str(props.filename);
      if (name !== undefined) out += ` data-filename="${escape(name)}"`;
      out += '><code';
      const language = str(props.language);
      if (language !== undefined) out += ` class="language-${escape(language)}"`;
      return `${out}>${escape(str(obj(block.text).s) ?? '')}</code></pre>\n`;
    }
    case 'image': {
      if (props.variant === 'file') {
        let out = '<ul>';
        for (const file of arr(props.files).map(obj)) {
          const name = escape(str(file.name) ?? '');
          const href = str(file.href);
          out += `<li>${href === undefined ? name : `<a href="${escape(href)}">${name}</a>`}</li>`;
        }
        return `${out}</ul>\n`;
      }
      let out = '';
      for (const image of arr(props.images).map(obj)) {
        out += `<figure><img src="${escape(str(image.src) ?? '')}"`;
        const alt = str(image.alt);
        if (alt !== undefined) out += ` alt="${escape(alt)}"`;
        out += '>';
        const caption = str(image.caption);
        if (caption !== undefined) out += `<figcaption>${escape(caption)}</figcaption>`;
        out += '</figure>\n';
      }
      return out;
    }
    case 'mockup':
      return `<div data-mockup>${str(props.markup) ?? ''}</div>\n`;
    case 'work-bundle': {
      let out = `<div data-work-bundle="${escape(str(props.page) ?? '')}"`;
      if (typeof props.number === 'number') out += ` data-number="${props.number}"`;
      out += '>';
      const work = str(props.work);
      if (work !== undefined) out += `<p>${escape(work)}</p>`;
      const tickets = arr(props.tickets).map(obj);
      if (tickets.length > 0) {
        out += '<ul>';
        for (const ticket of tickets) {
          out += `<li><a href="${escape(str(ticket.href) ?? '')}">${escape(str(ticket.label) ?? '')}</a></li>`;
        }
        out += '</ul>';
      }
      return `${out}</div>\n`;
    }
    case 'page-view': {
      let out = '<section data-page-view>';
      const label = str(props.label);
      if (label !== undefined) out += `<h3>${escape(label)}</h3>`;
      const rows = arr(props.rows).map(obj);
      if (rows.length > 0) {
        out += '<ul>';
        for (const row of rows) out += `<li>${escape(str(row.name) ?? '')}</li>`;
        out += '</ul>';
      }
      return `${out}</section>\n`;
    }
    default:
      return '';
  }
}

function children(all: Json, parent: string): string {
  const items = liveChildren(all, parent);
  let out = '';
  let at = 0;
  while (at < items.length) {
    if (isItem(items[at]![1])) {
      let end = at;
      while (end < items.length && isItem(items[end]![1])) end++;
      out += listRun(items.slice(at, end));
      at = end;
    } else {
      out += render1(all, items[at]![0], items[at]![1]);
      at++;
    }
  }
  return out;
}

/** The page's live blocks as HTML, each block-level fragment on its own line. */
export function renderBlocks(blocks: unknown): string {
  return children(obj(blocks), 'root');
}
