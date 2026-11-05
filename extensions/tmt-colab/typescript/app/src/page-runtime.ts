import pin from '../runtime-pin.json';
import { isHostedOrigin } from './hosted-location.js';

/** The marker a page uses to ask for the bundled runtime (#1693): the first
 * `<meta name="tmt-colab-runtime" content="react tailwind">` in document order. */
const MARKER = 'tmt-colab-runtime';
const TOKENS = new Set(['react', 'tailwind']);
/** The runtime is one bundle, so any known token loads all of it; unknown tokens are ignored. */
export function wantsRuntime(source: string): boolean {
  if (!source.includes(MARKER)) return false;
  const meta = new DOMParser()
    .parseFromString(source, 'text/html')
    .querySelector(`meta[name="${MARKER}"]`);
  return (meta?.getAttribute('content') ?? '')
    .split(/[ \t\n\f\r]+/)
    .some((token) => TOKENS.has(token));
}

/** What the frame bootstrap writes into its trusted head before the author's HTML: the theme
 * as the source of a `<style type="text/tailwindcss">` block, then the runtime's chunk scripts in
 * load order (#6085). The bootstrap enforces the byte caps. */
export interface PageRuntime {
  readonly scripts: readonly string[];
  readonly style: string;
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
  chunks: readonly (PinnedFile & { name: string })[];
  theme: PinnedFile;
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
 * The base and the named chunks, in vector order. The theme and the base must load; a lazy chunk
 * that fails to load or verify is left out, so only the components that need it show as
 * unavailable.
 */
export async function loadRuntime(
  baseUri: string,
  names: readonly string[] = ['base'],
): Promise<PageRuntime> {
  const wanted = runtimePin.chunks.filter(
    (chunk) => chunk.name === 'base' || names.includes(chunk.name),
  );
  const [style, ...scripts] = await Promise.all([
    pinnedText(baseUri, runtimePin.theme),
    ...wanted.map((chunk) =>
      chunk.name === 'base'
        ? pinnedText(baseUri, chunk)
        : pinnedText(baseUri, chunk).catch(() => undefined),
    ),
  ]);
  return Object.freeze({
    style: style!,
    scripts: Object.freeze(scripts.filter((script): script is string => script !== undefined)),
  });
}

/** Every chunk's text in load order, for a standalone export, which has no parent to ask. */
export const allRuntimeChunks = () => runtimePin.chunks.map((chunk) => chunk.name);

/** What a standalone export of a page that uses the design system carries (#5057): the same CSS and
 * `tmt-icon` script the renderer frame holds, built into the app as `colab-page-ui.css` and
 * `colab-page-ui.js`. */
export interface PageDesign {
  readonly script: string;
  readonly style: string;
}
const designs = new Map<string, Promise<PageDesign>>();
/** Fetched once per origin path; a failure is not cached. Only an export asks for it. */
export function loadDesign(baseUri: string): Promise<PageDesign> {
  const key = runtimeUrl(baseUri, 'assets/colab-page-ui.js');
  let design = designs.get(key);
  if (!design) {
    design = Promise.all([read(key), read(runtimeUrl(baseUri, 'assets/colab-page-ui.css'))]).then(
      ([script, style]) => Object.freeze({ script, style }),
    );
    design.catch(() => designs.delete(key));
    designs.set(key, design);
  }
  return design;
}
