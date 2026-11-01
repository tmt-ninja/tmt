// The tmt GUI template's live components are htm ports of browser-ui's ui components (#5866). Their
// class strings come from the ui component's own cva function, and every example must render the
// same element and class structure as the ui component, so a port cannot drift from its source.
import { createRequire } from 'node:module';

const app = createRequire(new URL('../../extensions/tmt-colab/typescript/app/package.json', import.meta.url));

/**
 * Every class the cva function gives each combination of the enumerated props, as one shared base
 * and the rest per combination keyed `value|value` in `dims` order. The runtime's `cn` only joins,
 * so the merged result is stored, never re-merged.
 */
export async function classTable(load, { module, variants, dims }) {
  const cva = (await load(module))[variants];
  if (typeof cva !== 'function') throw new Error(`${module} has no ${variants}`);
  // The component merges its variant classes (tailwind-merge) before drawing; the table stores that.
  const { cn } = await load('/src/ui/utils.ts');
  const names = Object.keys(dims);
  const combos = names.reduce(
    (all, name) => all.flatMap((combo) => dims[name].map((value) => [...combo, value])),
    [[]],
  );
  const lists = combos.map((combo) =>
    cn(cva(Object.fromEntries(names.map((name, index) => [name, combo[index]])))).split(' '),
  );
  const base = lists.reduce((shared, list) => shared.filter((name) => list.includes(name)));
  return {
    base: base.join(' '),
    by: Object.fromEntries(
      combos.map((combo, index) => [
        combo.join('|'),
        lists[index].filter((name) => !base.includes(name)).join(' '),
      ]),
    ),
  };
}

/** The example markup of a template component, as element trees: the subset our examples use
 * (double-quoted or bare attributes, text and nested elements), refused otherwise. */
export function parseMarkup(text) {
  let at = 0;
  const nodes = (closing) => {
    const out = [];
    while (at < text.length) {
      if (text.startsWith('</', at)) {
        const end = text.indexOf('>', at);
        const tag = text.slice(at + 2, end).trim();
        if (tag !== closing) throw new Error(`Unbalanced </${tag}> in ${text}`);
        at = end + 1;
        return out;
      }
      if (text[at] === '<') {
        const open = /^<([a-z][a-z0-9-]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>/.exec(text.slice(at));
        if (!open) throw new Error(`Unsupported markup at ${text.slice(at, at + 40)}`);
        at += open[0].length;
        const attrs = {};
        for (const [, name, value] of open[2].matchAll(/([a-z-]+)(?:="([^"]*)")?/g))
          attrs[name] = value ?? true;
        out.push({ tag: open[1], attrs, children: nodes(open[1]) });
      } else {
        const next = text.indexOf('<', at);
        const end = next < 0 ? text.length : next;
        out.push(text.slice(at, end));
        at = end;
      }
    }
    if (closing) throw new Error(`Missing </${closing}> in ${text}`);
    return out;
  };
  return nodes(null);
}

/** Elements, their `data-slot` and their class sets, in document order: what must match. */
export function structure(html) {
  return [...html.matchAll(/<([a-z][a-z0-9-]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)].map(
    ([, tag, attrs]) => {
      const attr = (name) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';
      const classes = attr('class').split(/\s+/).filter(Boolean).sort().join(' ');
      return `${tag}[${attr('data-slot')}]{${classes}}`;
    },
  );
}

/**
 * Render every example both ways, the template's htm component and the browser-ui component it
 * ports, and list each structural difference. `components` maps a template tag (`tmt-ui-<tag>`) to
 * its compiled code and its ui export.
 */
export async function markupDrift({ load, React, renderToStaticMarkup }, ported) {
  const htm = app('htm');
  const html = htm.bind(React.createElement);
  const cn = (...parts) => parts.filter(Boolean).join(' ');
  const template = new Map();
  const ui = new Map();
  for (const component of ported) {
    template.set(`tmt-ui-${component.tag}`, new Function(component.code)()({ React, html, cn }));
    ui.set(`tmt-ui-${component.tag}`, (await load(component.ui.module))[component.ui.component]);
  }
  const { UiTheme } = await load('/src/ui/theme.tsx');
  const element = (node, pick) => {
    if (typeof node === 'string') return node;
    const type = pick.get(node.tag) ?? node.tag;
    const props = { ...node.attrs };
    const slots = {};
    const children = [];
    for (const child of node.children) {
      const slot = typeof child === 'object' && child.attrs.slot;
      if (slot && pick.has(node.tag)) slots[slot] = element(child, pick);
      else children.push(element(child, pick));
    }
    // A template component takes a named slot as a prop; a ui component draws it first in its children.
    if (pick === template)
      for (const [name, value] of Object.entries(slots)) props[name] = value;
    else children.unshift(...Object.values(slots));
    return React.createElement(type, props, ...children);
  };
  const render = (nodes, pick) =>
    renderToStaticMarkup(
      React.createElement(UiTheme, { theme: 'light' }, ...nodes.map((node) => element(node, pick))),
    );
  const drift = [];
  for (const component of ported)
    for (const example of component.examples ?? []) {
      const nodes = parseMarkup(example.markup);
      const ours = structure(render(nodes, template));
      const theirs = structure(render(nodes, ui));
      if (ours.join('\n') !== theirs.join('\n'))
        drift.push(
          `${component.tag} "${example.title}":\n  template ${ours.join(' ')}\n  browser-ui ${theirs.join(' ')}`,
        );
    }
  return drift;
}
