// The design-system compiler and page check (#5821, epic #5866), with no Node or DOM dependency:
// design/systems/compile.mjs runs it on the repo's template files, and the Colab app runs the same
// code in the browser on a design system's pages. SHA-256 is passed in by the caller.

import findingTexts from './finding-texts.json' with { type: 'json' };
import runtime4 from '../../extensions/tmt-colab/contracts/vectors/design-runtime-4-ui.json' with { type: 'json' };
import sharedAttributes from './shared-attributes.json' with { type: 'json' };

export const SCHEMA = 1;
/** Default runtime 2 retains its original React, html and cn skeleton. Runtime 3 adds the
 * system prefix plus explicitly declared, allowlisted parts and data capabilities. */
export const RUNTIME = '2';
/** Runtime 3 adds only these explicitly declared host-provided parts. */
export const SHARED_PARTS = ['PageListTable'];
export const DATA_CAPABILITIES = ['page'];
/** Runtime 4's renderer-owned browser-ui exports and stylesheet-bearing block subset. */
export const UI_PARTS = Object.freeze([...runtime4.parts, ...runtime4.blockParts]);
export const BLOCK_UI_PARTS = Object.freeze(runtime4.blockParts);
export const SKELETON = ['React', 'html', 'cn'];
/** Attributes any component element may carry besides its props: one global rule, as data the
 * CLI page check reads too (#6713). A prefix needs at least one more character. */
export const SHARED_ATTRIBUTES = sharedAttributes;
const sharedNames = new Set(sharedAttributes.names);
const GLOBAL_ATTRIBUTES = {
  test: (name) =>
    sharedNames.has(name) ||
    sharedAttributes.prefixes.some((prefix) => name.length > prefix.length && name.startsWith(prefix)),
};

export class DesignSystemError extends Error {}
const fail = (message) => {
  throw new DesignSystemError(message);
};

/** A newer schema needs a newer reader; an older one has no conversion yet. */
export function checkSchema(doc, where) {
  if (typeof doc?.schema !== 'number') fail(`${where}: missing schema`);
  if (doc.schema > SCHEMA) fail(`${where}: schema ${doc.schema} needs a newer TMT`);
  if (doc.schema !== SCHEMA) fail(`${where}: schema ${doc.schema} is not ${SCHEMA}`);
}

export function propType(spec) {
  if (Array.isArray(spec?.enum) && spec.enum.every((value) => typeof value === 'string'))
    return spec.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (spec?.type === 'boolean') return 'boolean';
  if (spec?.type === 'string') return 'string';
  return fail(`unknown prop spec ${JSON.stringify(spec)}`);
}

/** The root page's DesignSystemConfig, as far as the compiler reads it. */
export function validateSystem(config, where = 'design system') {
  checkSchema(config, where);
  if (config.kind !== 'design-system') fail(`${where}: kind is not design-system`);
  if (typeof config.name !== 'string' || !config.name) fail(`${where}: needs a name`);
  if (typeof config.prefix !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(config.prefix))
    fail(`${where}: prefix must be lowercase words joined by hyphens`);
  if (![RUNTIME, '3', '4'].includes(config.runtime))
    fail(`${where}: unsupported runtime ${config.runtime}`);
  if (typeof config.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(config.version))
    fail(`${where}: version must be major.minor.patch`);
  if (typeof config.tokens?.css !== 'string') fail(`${where}: tokens.css must be CSS text`);
  if (/<!--|<\/style/i.test(config.tokens.css))
    fail(`${where}: tokens may not contain <!-- or </style`);
}

/** A component source is one `export default <factory>`, with no imports and no outside reach. */
export function checkSource(source, where) {
  if (typeof source !== 'string') fail(`${where}: source must be text`);
  if (!/^export default /m.test(source)) fail(`${where}: needs one export default`);
  if ((source.match(/\bexport\s/g) ?? []).length !== 1) fail(`${where}: exports only its default`);
  const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const banned of [
    'import',
    'require',
    'fetch',
    'XMLHttpRequest',
    'eval',
    'Function',
    'window',
    'document',
    'globalThis',
  ])
    if (new RegExp(`\\b${banned}\\b`).test(code))
      fail(
        `${where}: uses ${banned}; a component reads only the skeleton (${SKELETON.join(', ')})`
      );
  if (/<!--|<\/script/i.test(source)) fail(`${where}: may not contain <!-- or </script`);
}

/** A component page's data block: `{schema, kind, tag, props, slots, examples, source, css}`. */
export function validateComponent(doc, where = 'component') {
  checkSchema(doc, where);
  if (doc.kind !== 'component') fail(`${where}: kind is not component`);
  if (typeof doc.tag !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(doc.tag))
    fail(`${where}: tag must be lowercase words joined by hyphens`);
  if (!doc.props || typeof doc.props !== 'object') fail(`${where}: props must be an object`);
  for (const [name, spec] of Object.entries(doc.props)) {
    propType(spec);
    if (!/^[a-z][a-z0-9-]*$/.test(name) || GLOBAL_ATTRIBUTES.test(name))
      fail(`${where}: prop ${name} is not a free attribute name`);
    if (spec.default !== undefined && spec.enum && !spec.enum.includes(spec.default))
      fail(`${where}: ${name} default is outside its enum`);
  }
  if (!Array.isArray(doc.slots) || !doc.slots.includes('default'))
    fail(`${where}: slots must list default`);
  checkSource(doc.source, `${where} source`);
  if (typeof doc.css !== 'string' || /<!--|<\/style/i.test(doc.css))
    fail(`${where}: css must be text without <!-- or </style`);
}

/** Validate the same capability rules for authoring documents and untrusted stored bundles. */
export function validateCapabilities(bundle, prefixed = true) {
  if (!bundle || !Array.isArray(bundle.components) || typeof bundle.prefix !== 'string')
    fail('Invalid component capabilities');
  const { runtime, prefix, components } = bundle;
  const tags = components.map((doc) => doc?.tag);
  if (tags.some((tag) => typeof tag !== 'string') || new Set(tags).size !== tags.length)
    fail('two components share a tag or have an invalid tag');
  for (const doc of components) {
    for (const [field, allowed] of [
      ['parts', SHARED_PARTS],
      ['data', DATA_CAPABILITIES],
    ]) {
      const names = doc[field];
      if (names === undefined) continue;
      if (!['3', '4'].includes(runtime))
        fail(`${doc.tag}: ${field === 'parts' ? 'shared parts' : 'data capabilities'} require runtime 3`);
      if (!Array.isArray(names) || new Set(names).size !== names.length ||
          names.some((name) => typeof name !== 'string' || !allowed.includes(name)))
        fail(`${doc.tag}: unknown or duplicate ${field === 'parts' ? 'shared part' : 'data capability'}`);
    }
    const ui = doc.uiParts;
    if (ui !== undefined && (runtime !== '4' || !Array.isArray(ui) ||
        new Set(ui).size !== ui.length ||
        ui.some((name) => typeof name !== 'string' || !UI_PARTS.includes(name))))
      fail(`${doc.tag}: unknown or duplicate UI part`);
    const required = doc.requires;
    if (required === undefined) continue;
    if (!['3', '4'].includes(runtime) || !Array.isArray(required) ||
        new Set(required).size !== required.length || required.some((tag) => {
          if (typeof tag !== 'string') return true;
          const actual = prefixed ? `${prefix}-${tag}` : tag;
          return actual === doc.tag || !tags.includes(actual);
        }))
      fail(`${doc.tag}: invalid or missing component dependency`);
  }
}

/**
 * The release bundle: the system's tokens and every component, named by its own SHA-256. It also
 * carries what an agent reads to use the release (`tmt colab design show`): the principles and
 * each component's examples, with the system's own tags.
 */
export async function buildBundle(system, config, components, sha256Hex) {
  validateSystem(config, config.name);
  components.forEach((doc, index) => validateComponent(doc, `component ${index + 1}`));
  validateCapabilities({ runtime: config.runtime, prefix: config.prefix, components }, false);
  const body = {
    schema: SCHEMA,
    system,
    name: config.name,
    version: config.version,
    runtime: config.runtime,
    prefix: config.prefix,
    tokensCss: config.tokens.css,
    principles: config.principles ?? null,
    components: components.map((doc) => ({
      tag: `${config.prefix}-${doc.tag}`,
      props: doc.props,
      slots: doc.slots,
      ...(doc.parts === undefined ? {} : { parts: doc.parts }),
      ...(doc.data === undefined ? {} : { data: doc.data }),
      ...(doc.uiParts === undefined ? {} : { uiParts: doc.uiParts }),
      ...(doc.requires === undefined ? {} : { requires: doc.requires }),
      examples: (doc.examples ?? []).map(({ title, markup }) => ({
        title,
        markup: markup.replaceAll('tmt-ui-', `${config.prefix}-`),
      })),
      css: doc.css,
      code: doc.source.replace(/^export default /m, 'return '),
    })),
  };
  return { ...body, hash: `sha256-${await sha256Hex(JSON.stringify(body))}` };
}

/** The one component tag within two single-character edits of an unknown one with the system's
 * prefix, if exactly one is nearest; the CLI page check suggests the same (#6716). */
export function nearestTag(tag, prefix, tags) {
  const name = tag.startsWith(prefix) ? tag.slice(prefix.length) : undefined;
  if (name === undefined || !/^[\x00-\x7f]*$/.test(name) || name.length > 64) return undefined;
  let best = 3;
  let suggestion;
  for (const candidate of tags) {
    if (!candidate.startsWith(prefix)) continue;
    const other = candidate.slice(prefix.length);
    if (Math.abs(name.length - other.length) > 2) continue;
    const row = Array.from({ length: other.length + 1 }, (_, j) => j);
    for (let i = 0; i < name.length; i++) {
      let diagonal = row[0];
      row[0] = i + 1;
      for (let j = 0; j < other.length; j++) {
        const previous = row[j + 1];
        row[j + 1] = Math.min(diagonal + (name[i] === other[j] ? 0 : 1), previous + 1, row[j] + 1);
        diagonal = previous;
      }
    }
    const distance = row[other.length];
    if (distance < best) {
      best = distance;
      suggestion = candidate;
    } else if (distance === best) suggestion = undefined;
  }
  return suggestion;
}

/**
 * The page check for design-system markup. `elements` is every element of the page as
 * `{tag, attrs}`; `pin` is the page's `tmt-ds` pin or null; `bundle` is the pinned bundle or null
 * when it cannot be read. `pageElements` lists the host's own page elements, which belong to no
 * design system; Colab passes its contract list (contracts/vectors/page-elements-v1.json). Each
 * finding is `{code, tag, attribute?, index}`.
 */
export function checkElements(elements, pin, bundle, pageElements = []) {
  const own = new Set(pageElements);
  const findings = [];
  const candidates = elements
    .map((element, index) => ({ ...element, index }))
    .filter(({ tag }) => tag.includes('-') && !own.has(tag));
  if (!pin) {
    for (const { tag, index } of candidates)
      if (tag.startsWith('tmt-ui-')) {
        findings.push({ code: 'ds-not-pinned', tag, index });
      }
    return findings;
  }
  if (!bundle) return [{ code: 'unknown-ds-release', tag: 'meta', index: -1, system: pin.system }];
  const components = new Map(bundle.components.map((component) => [component.tag, component]));
  const system = pin.system;
  for (const { tag, attrs, index } of candidates) {
    const component = components.get(tag);
    if (!component) {
      const near = nearestTag(tag, `${bundle.prefix}-`, [...components.keys()]);
      findings.push({
        code: tag.startsWith(`${bundle.prefix}-`) ? 'unknown-ds-component' : 'ds-prefix-mismatch',
        tag,
        index,
        system,
        ...(near ? { near } : {}),
      });
      continue;
    }
    for (const [name, value] of Object.entries(attrs)) {
      if (GLOBAL_ATTRIBUTES.test(name)) continue;
      const spec = component.props[name];
      const valid =
        spec &&
        (spec.type === 'boolean'
          ? value === '' || value === name
          : !spec.enum || spec.enum.includes(value));
      if (valid) continue;
      // What the author gave and what the component takes, so the fix needs no other page (#6716).
      findings.push({
        code: 'invalid-ds-prop',
        tag,
        attribute: name,
        index,
        system,
        value,
        ...(!spec ? {} : spec.type === 'boolean' ? { boolean: true } : { allowed: spec.enum }),
      });
    }
  }
  return findings;
}

/** The finding texts both page checks render (#6716): this file's frame lines and the CLI's
 * messages and fixes come from `finding-texts.json`, filled with the finding's own values. */
export const FINDING_TEXTS = findingTexts;
const fill = (template, f) =>
  template.replace(/\{(\w+)\}/g, (_, name) =>
    name === 'prop'
      ? f.attribute
      : name === 'allowed'
        ? f.allowed.join(', ')
        : String(f[name]),
  );
/** Which fix a finding takes: the nearest tag or the list, the values allowed, or the lock. */
const fixOf = (f) =>
  f.code === 'unknown-ds-release'
    ? 'lock'
    : f.code === 'invalid-ds-prop'
      ? f.allowed
        ? 'allowed'
        : f.boolean
          ? 'boolean'
          : 'unknown'
      : f.near
        ? 'near'
        : 'list';
/** A finding's message and fix, as both checks word them. */
export function findingParts(f) {
  const texts = findingTexts.codes[f.code];
  const fix = texts.fix[fixOf(f)];
  return { message: fill(texts.message, f), fix: fix === undefined ? '' : fill(fix, f) };
}
/** One line per finding, for people: the element, then its message and fix. The CLI names the
 * element in its own column. */
export const findingText = Object.fromEntries(
  Object.keys(findingTexts.codes).map((code) => [
    code,
    (f) => {
      const { message, fix } = findingParts(f);
      const text = fix ? `${message} ${fix}` : message;
      return code === 'ds-not-pinned' || code === 'unknown-ds-release' ? text : `<${f.tag}>: ${text}`;
    },
  ]),
);
