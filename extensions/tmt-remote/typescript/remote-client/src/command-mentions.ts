// Ranges index the unchanged source in UTF-16 for DOM slicing. The shared board
// fixtures check their UTF-8 equivalents and exact command bytes.
export interface CommandMention {
  range: [number, number];
  content: [number, number];
  command: string;
}

const marked = (words: string) => (/^(?:!|！) /.test(words) ? words.slice(2) : undefined);
const opening = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)/;
const ticks = /`+/g;

export function commandMentions(source: string): CommandMention[] {
  const mentions: CommandMention[] = [];
  function add(start: number, end: number, from: number, text: string, command: string) {
    if (command.trim())
      mentions.push({ range: [start, end], content: [from, from + text.length], command });
  }
  function inline(from: number, to: number) {
    const words = source.slice(from, to);
    const delimiters = [...words.matchAll(ticks)];
    const next = new Map<number, number>();
    const matching = new Map<number, number>();
    for (let i = delimiters.length - 1; i >= 0; i--) {
      const length = delimiters[i]![0].length;
      const close = next.get(length);
      if (close !== undefined) matching.set(i, close);
      next.set(length, i);
    }
    for (let i = 0; i < delimiters.length; i++) {
      const token = delimiters[i]!;
      let slashes = 0;
      while (words[token.index - slashes - 1] === '\\') slashes++;
      if (slashes % 2) continue;
      const close = matching.get(i);
      if (close === undefined) continue;
      const end = delimiters[close]!;
      const start = token.index + token[0].length;
      const shown = words.slice(start, end.index);
      const command = marked(shown);
      if (command !== undefined)
        add(from + token.index, from + end.index + end[0].length, from + start, shown, command);
      i = close;
    }
  }
  const lines = [...source.matchAll(/[^\n]*(?:\n|$)/g)];
  let inlineStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = opening.exec(line[0]);
    if (!match || (match[2]![0] === '`' && match[3]!.includes('`'))) {
      // Indented code and paragraph boundaries cannot supply inline delimiters.
      if (/^(?: {4}|\t)/.test(line[0]) || !line[0].trim()) {
        inline(inlineStart, line.index);
        inlineStart = line.index + line[0].length;
      }
      continue;
    }
    inline(inlineStart, line.index);
    const delimiter = match[2]!;
    const close = new RegExp(`^ {0,3}${delimiter[0]}{${delimiter.length},}[ \t]*\r?\n?$`);
    const from = line.index + line[0].length;
    const label = match[3]!.trim().split(/\s+/, 1)[0]!.toLowerCase();
    let closing = i + 1;
    while (closing < lines.length && !close.test(lines[closing]![0])) closing++;
    if (closing === lines.length) return mentions;
    const end = lines[closing]!;
    const body = source.slice(from, end.index).replace(/\r?\n$/, '');
    const command = marked(body);
    if (command !== undefined || ['sh', 'bash', 'shell', 'zsh'].includes(label)) {
      add(
        line.index + match[1]!.length,
        end.index + end[0].replace(/\r?\n$/, '').length,
        from,
        body,
        command ?? body,
      );
    } else if (label === 'console' || label === 'shell-session') {
      for (let j = i + 1; j < closing; j++) {
        const prompt = lines[j]!;
        const shown = prompt[0].replace(/\r?\n$/, '');
        if (shown.startsWith('$ '))
          add(prompt.index, prompt.index + shown.length, prompt.index, shown, shown.slice(2));
      }
    }
    i = closing;
    inlineStart = end.index + end[0].length;
  }
  inline(inlineStart, source.length);
  return mentions;
}
