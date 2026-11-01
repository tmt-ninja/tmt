/**
 * The docs' stylesheets for a host page (#5866): every rule kept inside one element. The docs site
 * styles `:root`, `html` and `body`; hosted, those mean the docs' own element, and `@scope` keeps
 * every other rule from reaching the host's chrome. At-rules that `@scope` cannot hold move out.
 */
const page = /(^|[\s,>+~(}])(?::root|html|body)(?=[\s,{.:[)>+~]|$)/g;
const hoisted = /@(?:keyframes|font-face|property|import)\b[^{;]*(?:;|\{(?:[^{}]|\{[^{}]*\})*\})/g;

export function scopeCss(css: string, scope: string): string {
  const outside: string[] = [];
  const inside = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(hoisted, (rule) => {
      outside.push(rule);
      return '';
    })
    .replace(page, (_match, before: string) => `${before}:scope`);
  return `${outside.join('\n')}\n@scope (${scope}) {\n${inside}\n}\n`;
}
