// The tmt GUI template's live components are htm ports of browser-ui's ui components (#5866). Their
// class strings come from the ui component's own cva function, and every example must render the
// same element and class structure as the ui component, so a port cannot drift from its source.
import { createRequire } from 'node:module';

const app = createRequire(new URL('../../extensions/tmt-colab/typescript/app/package.json', import.meta.url));

/**
 * The classes a port draws with, taken from the ui component it ports. The root's classes for every
 * combination of the enumerated props (`dims`), as one shared base and the rest per combination
 * keyed `value|value` in `dims` order; with a cva export (`variants`) they come from it, merged
 * the way the component merges them, otherwise from rendering the component. Each named part
 * (another export of the module, such as CardTitle) gives the classes of its own element, keyed by
 * its data-slot. The runtime's `cn` only joins, so merged results are stored, never re-merged.
 */
export async function classTable({ load, React, renderToStaticMarkup }, ui) {
  const { module, component, variants, dims = {}, parts = [] } = ui;
  const exports = await load(module);
  const { cn } = await load('/src/ui/utils.ts');
  const { UiTheme } = await load('/src/ui/theme.tsx');
  const rootClass = (html) => /class="([^"]*)"/.exec(html)?.[1].replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&#x27;', "'").replaceAll('&quot;', '"') ?? '';
  const drawn = (type, props) =>
    rootClass(
      renderToStaticMarkup(React.createElement(UiTheme, { theme: 'light' }, React.createElement(type, props))).replace(
        /^<div data-tmt-ui="" data-tmt-theme="light">/,
        '',
      ),
    );
  const names = Object.keys(dims);
  const combos = names.reduce(
    (all, name) => all.flatMap((combo) => dims[name].map((value) => [...combo, value])),
    [[]],
  );
  const lists = combos.map((combo) => {
    const props = Object.fromEntries(names.map((name, index) => [name, combo[index]]));
    if (variants) {
      if (typeof exports[variants] !== 'function') throw new Error(`${module} has no ${variants}`);
      return cn(exports[variants](props)).split(' ');
    }
    return drawn(exports[component], props).split(' ').filter(Boolean);
  });
  const base = lists.reduce((shared, list) => shared.filter((name) => list.includes(name)));
  // The classes of every inner element (a switch's thumb, say), by data-slot, as drawn by default.
  const inner = {};
  // A component with parts that only draw inside it (Radix context) names a sample to draw them.
  if (ui.compose && ui.sample) {
    const html = renderToStaticMarkup(
      React.createElement(
        UiTheme,
        { theme: 'light' },
        React.createElement(composed(parseMarkup(ui.compose), exports, React), ui.sample),
      ),
    );
    for (const [, attrs] of html.matchAll(/<[a-z][a-z0-9-]*((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)) {
      const slot = /\sdata-slot="([^"]*)"/.exec(attrs)?.[1];
      const classes = /\sclass="([^"]*)"/.exec(attrs)?.[1];
      if (slot && classes) inner[slot] = rootClass(` class="${classes}"`);
    }
  } else if (!variants) {
    const html = renderToStaticMarkup(
      React.createElement(UiTheme, { theme: 'light' }, React.createElement(exports[component])),
    );
    for (const [, attrs] of html.matchAll(/<[a-z][a-z0-9-]*((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)) {
      const slot = /\sdata-slot="([^"]*)"/.exec(attrs)?.[1];
      const classes = /\sclass="([^"]*)"/.exec(attrs)?.[1];
      if (slot && classes) inner[slot] = rootClass(` class="${classes}"`);
    }
  }
  return {
    slots: inner,
    base: base.join(' '),
    by: Object.fromEntries(
      combos.map((combo, index) => [
        combo.join('|'),
        lists[index].filter((name) => !base.includes(name)).join(' '),
      ]),
    ),
    parts: Object.fromEntries(
      parts.map((part) => {
        const html = renderToStaticMarkup(
          React.createElement(UiTheme, { theme: 'light' }, React.createElement(exports[part])),
        );
        const slot = /data-tmt-theme="light"><[a-z]+[^>]*data-slot="([^"]+)"/.exec(html)?.[1];
        if (!slot) throw new Error(`${module} ${part} has no data-slot`);
        return [slot, drawn(exports[part], {})];
      }),
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
        const open = /^<([A-Za-z][A-Za-z0-9-]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>/.exec(text.slice(at));
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
 * A ui component drawn from its parts, as a port's `compose` names them: export names as tags,
 * `{prop}` text or attribute values from the example's props (`{children}` its content), and an
 * element with `if="prop"` drawn only when that prop is given.
 */
export function composed(tree, exports, React) {
  const Composed = (props) => {
    const value = (text, scope) => {
      const name = /^\{([a-z]+)\}$/.exec(text.trim())?.[1];
      return name ? scope[name] : text;
    };
    const draw = (node, key, scope) => {
      if (typeof node === 'string') return value(node, scope);
      if (node.attrs.if && scope[node.attrs.if] === undefined) return null;
      const { if: _if, each, ...attrs } = node.attrs;
      // `each="items"` repeats the element for every comma-separated value, named `{item}`.
      if (each)
        return String(scope[each] ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => draw({ ...node, attrs: attrs }, item, { ...scope, item }));
      const given = Object.fromEntries(
        Object.entries(attrs)
          .map(([name, text]) => [name, typeof text === 'string' ? value(text, scope) : text])
          .filter(([, text]) => text !== undefined),
      );
      return React.createElement(
        exports[node.tag] ?? node.tag,
        { ...given, key },
        ...node.children.map((child, index) => draw(child, index, scope)),
      );
    };
    return tree.map((node, index) => draw(node, index, props));
  };
  // Like the template component, it takes a named slot as a prop.
  Composed.takesSlots = true;
  return Composed;
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
    const exports = await load(component.ui.module);
    ui.set(
      `tmt-ui-${component.tag}`,
      component.ui.compose
        ? composed(parseMarkup(component.ui.compose), exports, React)
        : exports[component.ui.component],
    );
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
    if (pick === template || type.takesSlots)
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
      if (ours.join('\n') === theirs.join('\n')) continue;
      // Name the first element that differs and only what differs in it.
      const at = ours.findIndex((element, index) => element !== theirs[index]);
      const parts = (element = '') => {
        const [, head = '', classes = ''] = /^([^{]*)\{(.*)\}$/.exec(element) ?? [];
        return { head, classes: new Set(classes.split(' ').filter(Boolean)) };
      };
      const a = parts(ours[at]);
      const b = parts(theirs[at]);
      const only = (x, y) => [...x.classes].filter((name) => !y.classes.has(name)).join(' ');
      drift.push(
        `${component.tag} "${example.title}", element ${at + 1}: template ${a.head} vs browser-ui ${b.head}` +
          `; only in template: ${only(a, b) || '-'}; only in browser-ui: ${only(b, a) || '-'}` +
          ` (${ours.length} vs ${theirs.length} elements)`,
      );
    }
  return drift;
}
