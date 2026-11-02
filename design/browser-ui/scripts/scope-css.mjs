/**
 * The docs' stylesheets for a host page (#5866): every rule kept inside one element. The docs site
 * styles `:root`, `html` and `body`; hosted, those mean the docs' own element, and `@scope` keeps
 * every other rule from reaching the host's chrome. At-rules that `@scope` cannot hold move out.
 */
const page = /(^|[\s,>+~(}])(?::root|html|body)(?=[\s,{.:[)>+~]|$)/g;
const hoisted = /@(?:keyframes|font-face|property|import)\b[^{;]*(?:;|\{(?:[^{}]|\{[^{}]*\})*\})/g;

/** @param {string} css @param {string} scope @returns {string} */
export function scopeCss(css, scope) {
  const outside = [];
  const inside = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(hoisted, (rule) => {
      outside.push(rule);
      return '';
    })
    .replace(page, (_match, before) => `${before}:scope`);
  return `${outside.join('\n')}\n@scope (${scope}) {\n${inside}\n}\n`;
}
