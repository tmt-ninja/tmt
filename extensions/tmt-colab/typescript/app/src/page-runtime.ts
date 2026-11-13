import pin from '../runtime-pin.json';
import { isHostedOrigin } from './hosted-location.js';

/** The marker a page uses to ask for React (#1693, #6077): the first
 * `<meta name="tmt-colab-runtime" content="react">` in document order. Every page gets Tailwind, so
 * the `tailwind` token is still accepted but asks for nothing more; unknown tokens are ignored. */
const MARKER = 'tmt-colab-runtime';
export function wantsReact(source: string): boolean {
  if (!source.includes(MARKER)) return false;
  const meta = new DOMParser()
    .parseFromString(source, 'text/html')
    .querySelector(`meta[name="${MARKER}"]`);
  return (meta?.getAttribute('content') ?? '')
    .split(/[ \t\n\f\r]+/)
    .some((token) => token === 'react');
}

/** A class attribute, quoted or not, found by text: a page's own markup, never parsed. */
const CLASS_ATTRIBUTE = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
/**
 * Whether a page may use Tailwind utilities (#6077), so its frame needs the compiler: a class token
 * that is not the design system's own (`tmt-…`), or a script or inline handler that could add one.
 * A text test that over-approximates; a false match only loads the compiler. A page with neither
 * binds as it did before Tailwind was the default, with no compiler to load or run.
 */
export function wantsUtilities(source: string): boolean {
  if (/<script|\bon[a-z]+\s*=/i.test(source)) return true;
  for (const match of source.matchAll(CLASS_ATTRIBUTE)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (value.split(/[ \t\n\f\r]+/).some((token) => token !== '' && !token.startsWith('tmt-')))
      return true;
  }
  return false;
}

/** Whether the page carries the marker at all, whatever its tokens: the frame keeps the editorial
 * ramp for a design-system page that did not ask for the runtime itself (#5917). */
export function hasRuntimeMarker(source: string): boolean {
  return (
    source.includes(MARKER) &&
    new DOMParser().parseFromString(source, 'text/html').querySelector(`meta[name="${MARKER}"]`) !==
      null
  );
}

/**
 * What a page without React compiles before the theme (#6077): Tailwind's theme and utilities and
 * no preflight, so Colab's page style and design-system components keep their look. With no
 * `@import` of its own the browser compiler imports all of Tailwind, preflight included, which a
 * React page keeps as before. The theme's base layer paints the canvas for a React page; here it is
 * taken back (`:root` outranks the theme's `html`), so a plain page keeps its own canvas. The
 * compiler resolves only its own virtual sheets, never the network.
 */
export const UTILITIES_ONLY =
  '@layer theme, base, components, utilities;@import "tailwindcss/theme.css" layer(theme);@import "tailwindcss/utilities.css" layer(utilities);@layer base{:root{background-color:revert-layer}}\n';

/** What the frame bootstrap writes into its trusted head before the author's HTML: the theme
 * as the source of a `<style type="text/tailwindcss">` block, then the runtime's chunk scripts in
 * load order (#6085). The bootstrap enforces the byte caps. */
export interface PageRuntime {
  readonly scripts: readonly string[];
  readonly style: string;
  readonly wasm?: { readonly mime: 'application/wasm'; readonly bytes: ArrayBuffer };
}

/** Hosted routes share the root build-owned asset; mounted routes stay mount-relative. */
export function runtimeUrl(baseUri: string, path: string): string {
  const base = new URL(baseUri);
  return new URL(isHostedOrigin(base.origin) ? `/${path}` : `./${path}`, base).href;
}

/** A pinned file: its path, SHA-256 and length, as `runtime-pin.json` records them. */
interface PinnedFile {
  readonly path: string;
  readonly sha256: string;
  readonly length: number;
}
const runtimePin = pin as unknown as {
  chunks: readonly (PinnedFile & { name: string; kind?: 'wasm' })[];
  theme: PinnedFile;
  binder: PinnedFile;
};

const read = async (url: string): Promise<string> => {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Page runtime unavailable');
  return response.text();
};
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
/** A pinned file's text, only when its bytes are exactly the pinned ones. */
async function readPinned(baseUri: string, file: PinnedFile): Promise<string> {
  const response = await fetch(runtimeUrl(baseUri, file.path), { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Page runtime unavailable');
  const bytes = await response.arrayBuffer();
  if (
    bytes.byteLength !== file.length ||
    hex(await crypto.subtle.digest('SHA-256', bytes)) !== file.sha256
  )
    throw new Error('Page runtime file does not match its pin');
  return new TextDecoder().decode(bytes);
}

/** Fetch the optional renderer with a streaming bound before allocating the final buffer. */
async function readPinnedWasm(baseUri: string, file: PinnedFile): Promise<ArrayBuffer> {
  const limit = 614_400;
  if (file.length < 1 || file.length > limit) throw new Error('Renderer exceeds its bound');
  const response = await fetch(runtimeUrl(baseUri, file.path), { credentials: 'same-origin' });
  if (!response.ok || !response.body) throw new Error('Renderer unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > file.length || length > limit) throw new Error('Renderer exceeds its bound');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (length !== file.length || hex(await crypto.subtle.digest('SHA-256', bytes)) !== file.sha256)
    throw new Error('Renderer does not match its pin');
  return bytes.buffer;
}

const verifiedWasm = new Map<string, Promise<ArrayBuffer>>();
function pinnedWasm(baseUri: string, file: PinnedFile): Promise<ArrayBuffer> {
  const key = runtimeUrl(baseUri, file.path);
  let bytes = verifiedWasm.get(key);
  if (!bytes) {
    bytes = readPinnedWasm(baseUri, file);
    bytes.catch(() => verifiedWasm.delete(key));
    verifiedWasm.set(key, bytes);
  }
  return bytes;
}

const verified = new Map<string, Promise<string>>();
/** Each pinned file is fetched and verified once per tab and origin path, then reused by every page;
 * a failure is not kept, so the next page tries again. */
function pinnedText(baseUri: string, file: PinnedFile): Promise<string> {
  const key = runtimeUrl(baseUri, file.path);
  let text = verified.get(key);
  if (!text) {
    text = readPinned(baseUri, file);
    text.catch(() => verified.delete(key));
    verified.set(key, text);
  }
  return text;
}

/**
 * The base and the named chunks, in vector order. The theme, the base and (when named) React must
 * load; a lazy chunk that fails to load or verify is left out, so only the components that need it
 * show as unavailable. Without React the theme compiles Tailwind's utilities alone (#6077).
 */
export async function loadRuntime(
  baseUri: string,
  names: readonly string[] = ['base'],
): Promise<PageRuntime> {
  const wanted = runtimePin.chunks.filter(
    (chunk) => chunk.name === 'base' || names.includes(chunk.name),
  );
  const react = wanted.some((chunk) => chunk.name === 'react');
  const wasmFile = wanted.find((chunk) => chunk.kind === 'wasm');
  const textChunks = wanted.filter((chunk) => chunk.kind !== 'wasm');
  const [wasm, [style, ...scripts]] = await Promise.all([
    wasmFile ? pinnedWasm(baseUri, wasmFile).catch(() => undefined) : undefined,
    Promise.all([
      pinnedText(baseUri, runtimePin.theme),
      ...textChunks.map((chunk) =>
        chunk.name === 'base' || chunk.name === 'react'
          ? pinnedText(baseUri, chunk)
          : pinnedText(baseUri, chunk).catch(() => undefined),
      ),
    ]),
  ]);
  return Object.freeze({
    style: react ? style! : `${UTILITIES_ONLY}${style!}`,
    ...(wasm ? { wasm: { mime: 'application/wasm' as const, bytes: wasm } } : {}),
    scripts: Object.freeze(scripts.filter((script): script is string => script !== undefined)),
  });
}

/** Every chunk's text in load order, for a standalone export, which has no parent to ask. */
export const allRuntimeChunks = () =>
  runtimePin.chunks.filter((chunk) => chunk.kind !== 'wasm').map((chunk) => chunk.name);

/** What a standalone copy of a page that pins a design system carries (#6157): the theme, every
 * chunk's text by name in load order, and the binder that checks them when the file opens. Each is
 * verified against the pin here too; any failure rejects. */
export async function loadStandaloneRuntime(baseUri: string): Promise<{
  readonly theme: string;
  readonly binder: string;
  readonly chunks: readonly { readonly name: string; readonly text: string }[];
}> {
  const files = runtimePin.chunks.filter((chunk) => chunk.kind !== 'wasm');
  const [theme, binder, ...texts] = await Promise.all([
    pinnedText(baseUri, runtimePin.theme),
    pinnedText(baseUri, runtimePin.binder),
    ...files.map((chunk) => pinnedText(baseUri, chunk)),
  ]);
  return {
    theme: theme!,
    binder: binder!,
    chunks: files.map((chunk, index) => ({ name: chunk.name, text: texts[index]! })),
  };
}

/** The pinned terminal renderer as standard base64, for a standalone copy of a page whose design
 * system draws a TerminalFrame (#6157): the same verified bytes the frame is given. Rejects when it
 * is missing or differs from its pin. */
export async function loadStandaloneTerminal(baseUri: string): Promise<string> {
  const file = runtimePin.chunks.find((chunk) => chunk.kind === 'wasm');
  if (!file) throw new Error('Renderer unavailable');
  const bytes = new Uint8Array(await pinnedWasm(baseUri, file));
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** What a standalone export of a page that uses the design system carries (#5057): the same CSS and
 * `tmt-icon` script the renderer frame holds, built into the app as `colab-page-ui.json`
 * (`{style, script}`). */
export interface PageDesign {
  readonly script: string;
  readonly style: string;
}
const designs = new Map<string, Promise<PageDesign>>();
/** Fetched once per origin path; a failure is not cached. Only an export asks for it. */
export function loadDesign(baseUri: string): Promise<PageDesign> {
  const key = runtimeUrl(baseUri, 'assets/colab-page-ui.json');
  let design = designs.get(key);
  if (!design) {
    design = read(key).then((text) => {
      const { script, style } = JSON.parse(text) as Partial<Record<keyof PageDesign, unknown>>;
      if (typeof script !== 'string' || typeof style !== 'string')
        throw new Error('Page design unavailable');
      return Object.freeze({ script, style });
    });
    design.catch(() => designs.delete(key));
    designs.set(key, design);
  }
  return design;
}
