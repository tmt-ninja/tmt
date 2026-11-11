/**
 * Design systems on pages (#5821, Colab baea16b8): a page names its system with
 * `<meta name="tmt-ds" content="<system>">` and follows the system's live draft (#5967), or locks
 * one release with `content="<system>@<version>#sha256-…"`, and writes its components as
 * `<prefix>-<tag>` elements. The parent resolves and verifies the bundle and hands the frame the
 * `{script, style}` that defines those elements on the page runtime's React; the skeleton glue
 * below supports runtimes 2 and 3 and ships with the app, never in a bundle.
 */

import { runtimeChunkNames } from './runtime-chunks.js';
import {
  checkElements,
  findingText,
  validateCapabilities,
  BLOCK_UI_PARTS,
  type Bundle,
  type Finding,
} from '../../../../../design/systems/compiler.mjs';
import { elements as ownElements } from '../../../contracts/vectors/page-elements-v1.json';
import pageListCss from '@tmt/browser-ui/page-list.css?inline';
import dataTableCss from '@tmt/browser-ui/data-table.css?inline';
import richInputCss from '@tmt/browser-ui/rich-input.css?inline';
import blocksCss from '@tmt/browser-ui/blocks.css?inline';
import editorialCss from '@tmt/browser-ui/editorial.css?inline';

/** Runtime 2's skeleton remains supported unchanged alongside runtime 3. */
export const SKELETON_RUNTIME = '2';
const supportsRuntime = (runtime: string) => [SKELETON_RUNTIME, '3', '4'].includes(runtime);
const MARKER = 'tmt-ds';
/** The bootstrap's caps for the two strings, mirrored in renderer.html. */
export const DS_SCRIPT_BYTES = 512 * 1024;
export const DS_STYLE_BYTES = 512 * 1024;

/** A page's pin: the system, and the release it is locked to; without a lock it follows the draft. */
export interface DesignSystemPin {
  readonly system: string;
  readonly lock?: DesignSystemLock;
}
export interface DesignSystemLock {
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
  readonly parts?: readonly string[];
  readonly data?: readonly string[];
  readonly uiParts?: readonly string[];
  readonly requires?: readonly string[];
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
  /** A host-generated notice rather than a compiled design system. */
  readonly failure?: DesignSystemFailure;
  /** Host-only admission derived from the verified bundle, never from page markup alone. */
  readonly pageViewTags?: readonly string[];
  readonly pageDataTags?: readonly string[];
  /** The page runtime's chunks this page needs (#6085), from the verified bundle; the base alone
   * when absent. */
  readonly runtimeChunks?: readonly string[];
}
function supportsCapabilities(bundle: DesignSystemBundle): boolean {
  try {
    validateCapabilities(bundle);
    return true;
  } catch {
    return false;
  }
}

/** `<system>` or `<system>@<version>#<hash>`; the system is its root page's id. */
const PIN = /^([A-Za-z0-9_-]{1,128})(?:@(\d+\.\d+\.\d+)#(sha256-[0-9a-f]{64}))?$/;
/** A pin's content from a system and an optional lock (`follow`, or `<version>#<hash>`), or null
 * when they are not a pin's grammar: the frame is never handed a pin it would not parse itself. */
export function pinContent(system: unknown, lock?: unknown): string | null {
  const content =
    lock === undefined || lock === 'follow'
      ? `${String(system)}`
      : `${String(system)}@${String(lock)}`;
  return typeof system === 'string' &&
    (lock === undefined || typeof lock === 'string') &&
    PIN.test(content)
    ? content
    : null;
}
/** The page's pin: the first `<meta name="tmt-ds">` in document order, parsed with scripting off. */
export function designSystemPin(source: string): DesignSystemPin | null {
  if (!source.includes(MARKER)) return null;
  const content = new DOMParser()
    .parseFromString(source, 'text/html')
    .querySelector(`meta[name="${MARKER}"]`)
    ?.getAttribute('content')
    ?.trim();
  const match = content ? PIN.exec(content) : null;
  if (!match) return null;
  return match[2]
    ? { system: match[1]!, lock: { version: match[2], hash: match[3]! } }
    : { system: match[1]! };
}
/** Whether the page names a design system at all, pinned well or not. */
export const namesDesignSystem = (source: string) =>
  source.includes(MARKER) &&
  !!new DOMParser().parseFromString(source, 'text/html').querySelector(`meta[name="${MARKER}"]`);

/** The bundle's own hash: SHA-256 over its JSON without the `hash` field, in written key order. */
export async function bundleHash(bundle: DesignSystemBundle): Promise<string> {
  const { hash: _hash, ...body } = bundle;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(body)),
  );
  return `sha256-${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export type DesignSystemFailure =
  | 'unavailable'
  | 'unknown-release'
  | 'hash-mismatch'
  | 'newer-runtime'
  | 'newer-schema'
  | 'draft-broken';
/** A draft that does not compile, naming what to fix in Design. */
export class DesignDraftError extends Error {}
/** Where a page's bundle comes from, read by the caller with the access it has. */
export interface DesignSystemSource {
  /** A locked release: the system root page's release attachment. Undefined when the release or
   * its attachment cannot be read; the renderer verifies the bytes. */
  release(system: string, lock: DesignSystemLock): Promise<DesignSystemBundle | undefined>;
  /** The system's live draft, compiled as publish compiles it. Throws `DesignDraftError`. */
  draft(system: string): Promise<DesignSystemBundle>;
  /** Calls `changed` when the system's draft may have changed; returns the stop. */
  watch(system: string, changed: () => void): () => void;
}

/** The verified bundle a locked pin names, or why it cannot be used. */
export async function resolveDesignSystem(
  system: string,
  lock: DesignSystemLock,
  source: DesignSystemSource,
): Promise<DesignSystemBundle | DesignSystemFailure> {
  const bundle = await source.release(system, lock).catch(() => undefined);
  if (!bundle || bundle.version !== lock.version) return 'unknown-release';
  if (bundle.schema > 1) return 'newer-schema';
  if (bundle.hash !== lock.hash || (await bundleHash(bundle)) !== lock.hash) return 'hash-mismatch';
  if (!supportsRuntime(bundle.runtime) || !supportsCapabilities(bundle)) return 'newer-runtime';
  return bundle;
}

const notices: Record<DesignSystemFailure, string> = {
  unavailable:
    'This page’s design system release could not be read in time. Reopen the page to try again.',
  'unknown-release': 'This page pins a design system release this TMT does not have.',
  'hash-mismatch': 'This page’s design system bundle does not match its pin.',
  'newer-runtime': 'This page needs a newer TMT to show its components.',
  'newer-schema': 'This page needs a newer TMT to show its components.',
  'draft-broken': 'This page’s design system draft does not compile. Fix it in Design.',
};
const closes = (text: string, tag: string) =>
  text.includes('<!--') || text.toLowerCase().includes(`</${tag}`);
/** A frame script that only says why the components cannot be drawn. */
export function noticeFrame(failure: DesignSystemFailure, detail?: string): FrameDesignSystem {
  const text = JSON.stringify(detail ? `${notices[failure]} ${detail}` : notices[failure]).replace(
    /</g,
    '\\u003c',
  );
  return {
    style: '',
    failure,
    script: `addEventListener('DOMContentLoaded',()=>{const n=document.createElement('p');n.setAttribute('data-tmt-ds-notice','');n.setAttribute('role','alert');n.textContent=${text};document.body.prepend(n);});`,
  };
}

/** The frame's `{script, style}` for a verified bundle: one custom element per component, rendering
 * the component with the page runtime's React into the element's own light DOM. Slotted children
 * move, as DOM, into the rendered component; an element met while the page still parses waits for
 * its children, since the definitions run before the body. */
export function frameDesignSystem(
  bundle: DesignSystemBundle,
  pin: DesignSystemPin = { system: bundle.system },
): FrameDesignSystem {
  if (!supportsRuntime(bundle.runtime)) throw new Error('Unsupported design system runtime');
  validateCapabilities(bundle);
  const meta = JSON.stringify(
    bundle.components.map(({ tag, props, slots, parts, data, uiParts }) => ({
      tag,
      props,
      slots,
      parts: parts ?? [],
      data: data ?? [],
      uiParts: uiParts ?? [],
    })),
  ).replace(/</g, '\\u003c');
  // An element is only its rendered component's host, except at the top of the page: there it is
  // the box the frame's column rules (width, inset) apply to, so it stands on the column with the text.
  const tags = bundle.components.map(({ tag }) => tag).join(',');
  const hasPageList = bundle.components.some((component) =>
    component.parts?.includes('PageListTable'),
  );
  const hasDataTable =
    hasPageList || bundle.components.some((component) => component.uiParts?.includes('DataTable'));
  const hasRichInput = bundle.components.some((component) =>
    component.uiParts?.includes('RichInput'),
  );
  const hasBlocks = bundle.components.some((component) =>
    component.uiParts?.some((part) => BLOCK_UI_PARTS.includes(part)),
  );
  const hasEditorial = bundle.components.some((component) =>
    component.uiParts?.includes('BrowserEditorial'),
  );
  const sharedCss = `${hasPageList ? pageListCss : ''}\n${hasDataTable ? dataTableCss : ''}\n${hasRichInput ? richInputCss : ''}\n${hasBlocks ? blocksCss : ''}\n${hasEditorial ? editorialCss : ''}`;
  const style = `@layer tmt-ui{${bundle.tokensCss}\n:where(${tags}){display:contents}body>:where(${tags}){display:block}\n${sharedCss}\n${bundle.components.map(({ css }) => css).join('\n')}}`;
  const prefix = JSON.stringify(bundle.prefix).replace(/</g, '\\u003c');
  const pagePin = JSON.stringify({
    system: pin.system,
    version: pin.lock?.version ?? bundle.version,
    lock: pin.lock ? `${pin.lock.version}#${pin.lock.hash}` : 'follow',
  }).replace(/</g, '\\u003c');
  const script = `(()=>{const t=window.tmt;const meta=${meta},prefix=${prefix},pagePin=Object.freeze(${pagePin});
const factories=[${bundle.components.map(({ code }) => `(function(){${code}})()`).join(',')}];
if(!t||!t.React||!t.html||!t.createRoot)return;
const React=t.React,cn=(...parts)=>parts.filter(Boolean).join(' ');
const Unavailable=()=>React.createElement('span',{role:'status','data-tmt-part-unavailable':''},'Part unavailable');
const pending=(delta)=>{globalThis.__tmtPartsPending=(globalThis.__tmtPartsPending||0)+delta;};
const Painted=({el,children})=>{React.useLayoutEffect(()=>{if(el.__tmtPending){el.__tmtPending=false;pending(-1);}},[el]);return children;};
const Nodes=({nodes})=>{const ref=React.useRef(null);React.useLayoutEffect(()=>{if(ref.current)ref.current.replaceChildren(...nodes);},[nodes]);return React.createElement('tmt-slot',{ref,style:{display:'contents'}});};
meta.forEach((spec,index)=>{if(customElements.get(spec.tag))return;const parts=new Proxy(Object.create(null),{get(_target,name){if(typeof name!=='string'||!spec.parts.includes(name))throw new Error('Undeclared shared part: '+String(name));return t.sharedParts&&Object.hasOwn(t.sharedParts,name)?t.sharedParts[name]:Unavailable;}});const data=new Proxy(Object.create(null),{get(_target,name){if(typeof name!=='string'||!spec.data.includes(name)||!t.sharedData||!Object.hasOwn(t.sharedData,name))throw new Error('Undeclared data capability: '+String(name));return t.sharedData[name];}});const ui=new Proxy(Object.create(null),{get(_target,name){if(typeof name!=='string'||!spec.uiParts.includes(name))throw new Error('Undeclared UI part: '+String(name));return t.ui&&Object.hasOwn(t.ui,name)?t.ui[name]:Unavailable;}});const skeleton=Object.freeze(${bundle.runtime === '4' ? '{React,html:t.html,cn,parts,data,prefix,ui,pagePin}' : bundle.runtime === '3' ? '{React,html:t.html,cn,parts,data,prefix}' : '{React,html:t.html,cn}'});const Component=factories[index](skeleton);
customElements.define(spec.tag,class extends HTMLElement{static get observedAttributes(){return Object.keys(spec.props);}
connectedCallback(){if(document.readyState==='loading'){if(!this.waiting){this.waiting=true;document.addEventListener('DOMContentLoaded',()=>{if(this.isConnected)this.connectedCallback();},{once:true});}return;}if(!this.root){if(!this.slots){this.slots={};for(const node of [...this.childNodes]){const name=node.nodeType===1&&node.getAttribute('slot');const slot=name&&spec.slots.includes(name)?name:'default';(this.slots[slot]??=[]).push(node);node.remove();}}this.root=t.createRoot(this);this.__tmtPending=true;pending(1);}this.paint();}
disconnectedCallback(){if(this.__tmtPending){this.__tmtPending=false;pending(-1);}const root=this.root;if(root)queueMicrotask(()=>{if(!this.isConnected&&this.root===root){root.unmount();this.root=null;}});}
attributeChangedCallback(){if(this.root)this.paint();}
paint(){const props={};for(const [name,rule] of Object.entries(spec.props)){if(rule.type==='boolean')props[name]=this.hasAttribute(name);else if(this.hasAttribute(name))props[name]=this.getAttribute(name);}
for(const slot of spec.slots){const nodes=this.slots[slot];if(nodes&&nodes.length)props[slot==='default'?'children':slot]=React.createElement(Nodes,{nodes});}
this.root.render(React.createElement(Painted,{el:this},React.createElement(Component,props)));}});});})();`;
  if (closes(script, 'script') || closes(style, 'style'))
    throw new Error('A design system bundle may not end its own element');
  const size = (text: string) => new TextEncoder().encode(text).byteLength;
  if (size(script) > DS_SCRIPT_BYTES || size(style) > DS_STYLE_BYTES)
    throw new Error('A design system bundle is over the frame caps');
  return { script, style };
}

/** Whether the page writes an element of the TMT prefix, pinned or not (the page check's reach). */
export const writesDesignSystemTags = (source: string) => /<tmt-ui-[a-z]/i.test(source);

/** Every element of the page as `{tag, attrs}`, parsed inertly. */
/** The design-system page check with Colab's own page elements skipped, from the contract's list. */
export const checkPageElements = (
  elements: Parameters<typeof checkElements>[0],
  pin: Parameters<typeof checkElements>[1],
  bundle: Bundle | null,
) => checkElements(elements, pin, bundle, ownElements);

function pageElements(source: string) {
  return [...new DOMParser().parseFromString(source, 'text/html').body.querySelectorAll('*')].map(
    (element) => ({
      tag: element.localName,
      attrs: Object.fromEntries([...element.attributes].map((a) => [a.name, a.value])),
    }),
  );
}

/** A frame script that lists the page check's findings at the top of the page. */
function findingsScript(findings: readonly Finding[]): string {
  if (!findings.length) return '';
  const lines = JSON.stringify(
    findings.map((finding) => findingText[finding.code](finding)),
  ).replace(/</g, '\\u003c');
  return `addEventListener('DOMContentLoaded',()=>{const box=document.createElement('aside');box.setAttribute('data-tmt-ds-findings','');box.setAttribute('role','status');box.setAttribute('aria-label','Design system check');box.style.cssText='margin:0 0 12px;padding:8px 12px;border:1px solid var(--tmt-ui-color-waiting,#8a5a08);border-radius:6px;font:13px/1.4 system-ui,sans-serif;color:inherit';const list=document.createElement('ul');list.style.cssText='margin:0;padding-left:18px';for(const line of ${lines}){const item=document.createElement('li');item.textContent=line;list.append(item);}box.append(list);document.body.prepend(box);});`;
}

/** How long a page waits for its pinned release before it renders with a notice instead. */
export const PIN_WAIT_MS = 4000;
/** Each locked pin's outcome for the session, by the whole pin: a verified bundle or the failure.
 * A release never changes under its pin, and a pin that failed is not fetched again until a
 * reload, so one page's bad pin can never stand in for another release, and a dead pin costs one
 * read. A draft changes, so its source keeps (and drops) its own compiled bundle. */
const outcomes = new Map<string, Promise<DesignSystemBundle | DesignSystemFailure>>();
type Outcome = DesignSystemBundle | { failure: DesignSystemFailure; detail?: string };
function outcome(pin: DesignSystemPin, from: DesignSystemSource): Promise<Outcome> {
  const { system, lock } = pin;
  if (!lock)
    return from.draft(system).then(
      (bundle) =>
        supportsRuntime(bundle.runtime) && supportsCapabilities(bundle)
          ? bundle
          : { failure: 'newer-runtime' },
      (error: unknown) => ({
        failure: 'draft-broken',
        ...(error instanceof DesignDraftError && { detail: error.message }),
      }),
    );
  const key = `${system}@${lock.version}#${lock.hash}`;
  let result = outcomes.get(key);
  if (!result) outcomes.set(key, (result = resolveDesignSystem(system, lock, from)));
  return result.then((value) => (typeof value === 'string' ? { failure: value } : value));
}
const deadline = () =>
  new Promise<Outcome>((resolve) =>
    setTimeout(() => resolve({ failure: 'unavailable' }), PIN_WAIT_MS),
  );

/** The system a page follows live (its pin has no lock), for the renderer to watch. */
export function followedSystem(source: string): string | undefined {
  const pin = namesDesignSystem(source) ? designSystemPin(source) : null;
  return pin && !pin.lock ? pin.system : undefined;
}

/** The Design docs chrome (the article, stages and snippets of a component page), scoped to
 * `.tmt-design-docs`. The Design tab owns it: a page that draws in that wrapper gets it whatever its
 * system, so a system with no CSS of its own (tmt-tui's) draws its docs as the tmt GUI does. It is
 * read only when a page needs it, as its own chunk (#6272). */
const usesDocsChrome = (source: string) => /\btmt-design-docs\b/.test(source);
const docsChrome = () => import('./design-docs-chrome.js').then((module) => module.default);

/** The frame's design system for a page, or undefined when it needs none: the components of the
 * draft or locked release, the page check's findings, or the notice that they cannot be used. */
export async function loadDesignSystem(
  source: string,
  from: DesignSystemSource | undefined,
): Promise<FrameDesignSystem | undefined> {
  const named = namesDesignSystem(source);
  if (!named && !writesDesignSystemTags(source)) return undefined;
  const pin = named ? designSystemPin(source) : null;
  const elements = pageElements(source);
  if (!named) return { style: '', script: findingsScript(checkPageElements(elements, null, null)) };
  if (!pin || !from) return noticeFrame('unknown-release');
  // A slow or stuck read never blanks the page: past the deadline it renders with the notice, and
  // the read goes on for the next open.
  const bundle = await Promise.race([outcome(pin, from), deadline()]);
  if ('failure' in bundle) return noticeFrame(bundle.failure, bundle.detail);
  const frame = frameDesignSystem(bundle, pin);
  const findings = findingsScript(checkPageElements(elements, pin, bundle as unknown as Bundle));
  // In the system's layer, after its own rules, as the tmt GUI's bundle carried them before.
  const docs = usesDocsChrome(source) ? await docsChrome() : '';
  return {
    style: docs ? `${frame.style}\n@layer tmt-ui{${docs}}` : frame.style,
    script: `${frame.script}${findings}`,
    pageViewTags: bundle.components
      .filter((component) => component.parts?.includes('PageListTable'))
      .map((component) => component.tag),
    pageDataTags: bundle.components
      .filter((component) => component.data?.includes('page'))
      .map((component) => component.tag),
    runtimeChunks: runtimeChunkNames(
      bundle.components,
      bundle.prefix,
      new Set(elements.map((element) => element.tag)),
    ),
  };
}
