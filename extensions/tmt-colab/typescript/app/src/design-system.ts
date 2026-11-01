/**
 * Design systems on pages (#5821, Colab baea16b8): a page pins one released bundle with
 * `<meta name="tmt-ds" content="<system>@<version>#sha256-…">` and writes its components as
 * `<prefix>-<tag>` elements. The parent resolves and verifies the bundle and hands the frame the
 * `{script, style}` that defines those elements on the page runtime's React; the skeleton glue
 * below is runtime 2 and ships with the app, never in a bundle.
 */

/** The skeleton API this app runs bundles on: the page runtime's React and htm, plus cn. */
export const SKELETON_RUNTIME = '2';
const MARKER = 'tmt-ds';
/** The bootstrap's caps for the two strings, mirrored in renderer.html. */
export const DS_SCRIPT_BYTES = 512 * 1024;
export const DS_STYLE_BYTES = 512 * 1024;

export interface DesignSystemPin {
  readonly system: string;
  readonly version: string;
  readonly hash: string;
}
export interface DesignSystemProp {
  readonly enum?: readonly string[];
  readonly type?: 'boolean' | 'string';
  readonly default?: string;
}
export interface DesignSystemComponent {
  readonly tag: string;
  readonly props: Readonly<Record<string, DesignSystemProp>>;
  readonly slots: readonly string[];
  readonly css: string;
  readonly code: string;
}
export interface DesignSystemBundle {
  readonly schema: number;
  readonly system: string;
  readonly name: string;
  readonly version: string;
  readonly runtime: string;
  readonly prefix: string;
  readonly tokensCss: string;
  readonly components: readonly DesignSystemComponent[];
  readonly hash: string;
}
/** What the frame bootstrap writes after the page runtime. */
export interface FrameDesignSystem {
  readonly script: string;
  readonly style: string;
}

/** `<system>@<version>#<hash>`; the system is its root page's id. */
const PIN = /^([A-Za-z0-9_-]{1,128})@(\d+\.\d+\.\d+)#(sha256-[0-9a-f]{64})$/;
/** The page's pin: the first `<meta name="tmt-ds">` in document order, parsed with scripting off. */
export function designSystemPin(source: string): DesignSystemPin | null {
  if (!source.includes(MARKER)) return null;
  const content = new DOMParser()
    .parseFromString(source, 'text/html')
    .querySelector(`meta[name="${MARKER}"]`)
    ?.getAttribute('content')
    ?.trim();
  const match = content ? PIN.exec(content) : null;
  return match ? { system: match[1]!, version: match[2]!, hash: match[3]! } : null;
}
/** Whether the page names a design system at all, pinned well or not. */
export const namesDesignSystem = (source: string) =>
  source.includes(MARKER) &&
  !!new DOMParser().parseFromString(source, 'text/html').querySelector(`meta[name="${MARKER}"]`);

/** The bundle's own hash: SHA-256 over its JSON without the `hash` field, in written key order. */
export async function bundleHash(bundle: DesignSystemBundle): Promise<string> {
  const { hash: _hash, ...body } = bundle;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  return `sha256-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export type DesignSystemFailure =
  | 'unknown-release'
  | 'hash-mismatch'
  | 'newer-runtime'
  | 'newer-schema';
/** Where a pinned bundle's bytes come from: the system root page's release attachment, read by the
 * caller with the access it has. Undefined when the release or its attachment cannot be read. */
export type DesignSystemSource = (pin: DesignSystemPin) => Promise<DesignSystemBundle | undefined>;

/** The verified bundle a pin names, or why it cannot be used. */
export async function resolveDesignSystem(
  pin: DesignSystemPin,
  source: DesignSystemSource,
): Promise<DesignSystemBundle | DesignSystemFailure> {
  const bundle = await source(pin).catch(() => undefined);
  if (!bundle || bundle.version !== pin.version) return 'unknown-release';
  if (bundle.schema > 1) return 'newer-schema';
  if (bundle.hash !== pin.hash || (await bundleHash(bundle)) !== pin.hash) return 'hash-mismatch';
  if (bundle.runtime !== SKELETON_RUNTIME) return 'newer-runtime';
  return bundle;
}

const notices: Record<DesignSystemFailure, string> = {
  'unknown-release': 'This page pins a design system release this TMT does not have.',
  'hash-mismatch': 'This page’s design system bundle does not match its pin.',
  'newer-runtime': 'This page needs a newer TMT to show its components.',
  'newer-schema': 'This page needs a newer TMT to show its components.',
};
const closes = (text: string, tag: string) =>
  text.includes('<!--') || text.toLowerCase().includes(`</${tag}`);
/** A frame script that only says why the components cannot be drawn. */
export function noticeFrame(failure: DesignSystemFailure): FrameDesignSystem {
  const text = JSON.stringify(notices[failure]).replace(/</g, '\\u003c');
  return {
    style: '',
    script: `addEventListener('DOMContentLoaded',()=>{const n=document.createElement('p');n.setAttribute('data-tmt-ds-notice','');n.setAttribute('role','alert');n.textContent=${text};document.body.prepend(n);});`,
  };
}

/** The frame's `{script, style}` for a verified bundle: one custom element per component, rendering
 * the component with the page runtime's React into the element's own light DOM. Slotted children
 * move, as DOM, into the rendered component. */
export function frameDesignSystem(bundle: DesignSystemBundle): FrameDesignSystem {
  const meta = JSON.stringify(
    bundle.components.map(({ tag, props, slots }) => ({ tag, props, slots })),
  ).replace(/</g, '\\u003c');
  const style = `@layer tmt-ui{${bundle.tokensCss}\n${bundle.components
    .map(({ tag }) => `${tag}{display:contents}`)
    .join('')}\n${bundle.components.map(({ css }) => css).join('\n')}}`;
  const script = `(()=>{const t=window.tmt;const meta=${meta};
const factories=[${bundle.components.map(({ code }) => `(function(){${code}})()`).join(',')}];
if(!t||!t.React||!t.html||!t.createRoot)return;
const React=t.React,cn=(...parts)=>parts.filter(Boolean).join(' ');
const skeleton=Object.freeze({React,html:t.html,cn});
const Nodes=({nodes})=>{const ref=React.useRef(null);React.useLayoutEffect(()=>{if(ref.current)ref.current.replaceChildren(...nodes);},[nodes]);return React.createElement('tmt-slot',{ref,style:{display:'contents'}});};
meta.forEach((spec,index)=>{if(customElements.get(spec.tag))return;const Component=factories[index](skeleton);
customElements.define(spec.tag,class extends HTMLElement{static get observedAttributes(){return Object.keys(spec.props);}
connectedCallback(){if(!this.root){this.slots={};for(const node of [...this.childNodes]){const name=node.nodeType===1&&node.getAttribute('slot');const slot=name&&spec.slots.includes(name)?name:'default';(this.slots[slot]??=[]).push(node);node.remove();}this.root=t.createRoot(this);}this.paint();}
attributeChangedCallback(){if(this.root)this.paint();}
paint(){const props={};for(const [name,rule] of Object.entries(spec.props)){if(rule.type==='boolean')props[name]=this.hasAttribute(name);else if(this.hasAttribute(name))props[name]=this.getAttribute(name);}
for(const slot of spec.slots){const nodes=this.slots[slot];if(nodes&&nodes.length)props[slot==='default'?'children':slot]=React.createElement(Nodes,{nodes});}
React.startTransition?this.root.render(React.createElement(Component,props)):this.root.render(React.createElement(Component,props));}});});})();`;
  if (closes(script, 'script') || closes(style, 'style'))
    throw new Error('A design system bundle may not end its own element');
  const size = (text: string) => new TextEncoder().encode(text).byteLength;
  if (size(script) > DS_SCRIPT_BYTES || size(style) > DS_STYLE_BYTES)
    throw new Error('A design system bundle is over the frame caps');
  return { script, style };
}

/** The frame's design system for a page, or undefined when it names none. */
export async function loadDesignSystem(
  source: string,
  from: DesignSystemSource | undefined,
): Promise<FrameDesignSystem | undefined> {
  if (!namesDesignSystem(source)) return undefined;
  const pin = designSystemPin(source);
  if (!pin || !from) return noticeFrame('unknown-release');
  const bundle = await resolveDesignSystem(pin, from);
  return typeof bundle === 'string' ? noticeFrame(bundle) : frameDesignSystem(bundle);
}
