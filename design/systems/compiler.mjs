// The design-system compiler and page check (#5821, epic #5866), with no Node or DOM dependency:
// design/systems/compile.mjs runs it on the repo's template files, and the Colab app runs the same
// code in the browser on a design system's pages. SHA-256 is passed in by the caller.

export const SCHEMA = 1;
/** The skeleton API a bundle runs on (runtime 2): the page runtime's React and htm, plus cn. */
export const RUNTIME = '2';
export const SKELETON = ['React', 'html', 'cn'];
/** Attributes any component element may carry besides its props. */
const GLOBAL_ATTRIBUTES = /^(class|id|style|slot|title|lang|dir|hidden|tabindex|role|data-.+|aria-.+)$/;
/** Custom elements the page frame defines itself; they belong to no design system. */
const FRAME_ELEMENTS = new Set(['tmt-icon', 'tmt-slot']);

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
  if (config.runtime !== RUNTIME) fail(`${where}: runtime ${config.runtime} is not ${RUNTIME}`);
  if (typeof config.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(config.version))
    fail(`${where}: version must be major.minor.patch`);
  if (typeof config.tokens?.css !== 'string') fail(`${where}: tokens.css must be CSS text`);
  if (/<!--|<\/style/i.test(config.tokens.css)) fail(`${where}: tokens may not contain <!-- or </style`);
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
      fail(`${where}: uses ${banned}; a component reads only the skeleton (${SKELETON.join(', ')})`);
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

/** The release bundle: the system's tokens and every component, named by its own SHA-256. */
export async function buildBundle(system, config, components, sha256Hex) {
  validateSystem(config, config.name);
  components.forEach((doc, index) => validateComponent(doc, `component ${index + 1}`));
  const tags = components.map((doc) => doc.tag);
  if (new Set(tags).size !== tags.length) fail('two components share a tag');
  const body = {
    schema: SCHEMA,
    system,
    name: config.name,
    version: config.version,
    runtime: RUNTIME,
    prefix: config.prefix,
    tokensCss: config.tokens.css,
    components: components.map((doc) => ({
      tag: `${config.prefix}-${doc.tag}`,
      props: doc.props,
      slots: doc.slots,
      css: doc.css,
      code: doc.source.replace(/^export default /m, 'return '),
    })),
  };
  return { ...body, hash: `sha256-${await sha256Hex(JSON.stringify(body))}` };
}

/**
 * The page check for design-system markup. `elements` is every element of the page as
 * `{tag, attrs}`; `pin` is the page's `tmt-ds` pin or null; `bundle` is the pinned bundle or null
 * when it cannot be read. Each finding is `{code, tag, attribute?, index}`.
 */
export function checkElements(elements, pin, bundle) {
  const findings = [];
  const candidates = elements
    .map((element, index) => ({ ...element, index }))
    .filter(({ tag }) => tag.includes('-') && !FRAME_ELEMENTS.has(tag));
  if (!pin) {
    for (const { tag, index } of candidates)
      if (tag.startsWith('tmt-ui-')) findings.push({ code: 'ds-not-pinned', tag, index });
    return findings;
  }
  if (!bundle) return [{ code: 'unknown-ds-release', tag: 'meta', index: -1 }];
  const components = new Map(bundle.components.map((component) => [component.tag, component]));
  for (const { tag, attrs, index } of candidates) {
    const component = components.get(tag);
    if (!component) {
      findings.push({
        code: tag.startsWith(`${bundle.prefix}-`) ? 'unknown-ds-component' : 'ds-prefix-mismatch',
        tag,
        index,
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
      if (!valid) findings.push({ code: 'invalid-ds-prop', tag, attribute: name, index });
    }
  }
  return findings;
}

/** One line per finding, for people. */
export const findingText = {
  'ds-not-pinned': (f) => `<${f.tag}> needs the page to pin a design system (<meta name="tmt-ds">).`,
  'unknown-ds-release': () => 'The pinned design system release cannot be read.',
  'ds-prefix-mismatch': (f) => `<${f.tag}> is not from the pinned design system.`,
  'unknown-ds-component': (f) => `<${f.tag}> is not a component of the pinned design system.`,
  'invalid-ds-prop': (f) => `<${f.tag}> has an invalid ${f.attribute} attribute.`,
};
