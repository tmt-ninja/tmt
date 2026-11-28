export type TicketReference = { kind: 'github' | 'work'; text: string };

export interface TicketLink {
  from: number;
  to: number;
  href: string;
}

export interface TicketLinks {
  href(reference: TicketReference): string | undefined;
  open(href: string, newTab: boolean): void;
}

type MarkRange = Readonly<{ from: number; to: number; mark: string }>;

const TICKET =
  /(?<![\p{L}\p{N}\p{M}_/@#?&=%.+-])(?:#[1-9][0-9]{0,18}|[A-Z]{1,6}-[1-9][0-9]{0,18})(?![\p{L}\p{N}\p{M}_/@#?&=%+-])/gu;
const URL = /(?:https?:\/\/|www\.)[^\s<>]+/gi;

/** Display links use scalar offsets, like the block's authored marks. */
export function ticketLinks(
  text: string,
  marks: readonly MarkRange[] | undefined,
  resolve: TicketLinks['href'],
): TicketLink[] {
  const urls = [...text.matchAll(URL)];
  let urlIndex = 0;
  let offset = 0;
  let scalar = 0;
  const links: TicketLink[] = [];
  for (const match of text.matchAll(TICKET)) {
    const literal = match[0];
    const index = match.index;
    scalar += Array.from(text.slice(offset, index)).length;
    const from = scalar;
    const to = from + literal.length;
    offset = index + literal.length;
    scalar = to;
    while (urlIndex < urls.length && urls[urlIndex]!.index + urls[urlIndex]![0].length <= index)
      urlIndex++;
    if (urls[urlIndex] && urls[urlIndex]!.index < offset) continue;
    if (
      marks?.some(
        (mark) =>
          mark.from < to &&
          mark.to > from &&
          ((mark.mark !== 'bold' && mark.mark !== 'italic') || mark.from > from || mark.to < to),
      )
    )
      continue;
    const href = resolve({ kind: literal.startsWith('#') ? 'github' : 'work', text: literal });
    if (href) links.push({ from, to, href });
  }
  return links;
}

export function validTicketRepository(repository: string): boolean {
  const match = /^([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9_.][a-z0-9_.-]{0,99})$/i.exec(
    repository,
  );
  return match?.[0] === repository && match[2] !== '.' && match[2] !== '..';
}

/** Fast check before the owner list is requested; full spelling and mark admission comes later. */
export function mayContainWorkNumber(text: string): boolean {
  return /[A-Z]{1,6}-[1-9]/u.test(text);
}

export function githubTicket(repository: string, number: string): string {
  return 'https://github.com/' + repository + '/issues/' + number;
}
