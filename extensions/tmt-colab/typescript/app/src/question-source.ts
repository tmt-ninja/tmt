/** Remove one admitted question without reserializing the authored source. The browser's inert
 * parser proves that the byte-range removal has exactly the same DOM effect as removing the
 * selected element; lookalikes in scripts, comments and attributes cannot acquire authority. */
export function removeQuestion(source: string, id: string): string {
  const parse = (html: string) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template;
  };
  const expected = parse(source);
  const targets = [...expected.content.querySelectorAll('tmt-question')].filter(
    (node) => node.getAttribute('data-id') === id,
  );
  if (targets.length !== 1) throw new Error('Question is missing or ambiguous');
  const target = targets[0];
  const markup = target.outerHTML;
  target.remove();
  const result = expected.innerHTML;
  const openings = /<tmt-question(?=[\s/>])/gi;
  const matches: string[] = [];
  let opening: RegExpExecArray | null;
  let inspected = 0;
  while ((opening = openings.exec(source))) {
    if (++inspected > 256) throw new Error('Question source cannot be removed safely');
    let quote = '';
    let end = openings.lastIndex;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    if (end === source.length) break;
    const head = source.slice(opening.index, end + 1);
    const probe = parse(`${head}</tmt-question>`).content.querySelector('tmt-question');
    if (probe?.getAttribute('data-id') !== id) continue;
    const closings = /<\/tmt-question\s*>/gi;
    closings.lastIndex = end + 1;
    let checked = 0;
    while (closings.exec(source) && checked++ < 256) {
      const finish = closings.lastIndex;
      const candidate = parse(source.slice(opening.index, finish));
      if (
        candidate.content.children.length !== 1 ||
        candidate.content.firstElementChild?.outerHTML !== markup
      )
        continue;
      const next = source.slice(0, opening.index) + source.slice(finish);
      if (parse(next).innerHTML === result) matches.push(next);
    }
  }
  if (matches.length !== 1) throw new Error('Question source cannot be removed safely');
  return matches[0];
}
