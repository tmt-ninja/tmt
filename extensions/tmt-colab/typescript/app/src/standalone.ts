/** The standalone copy of a page that opts in to the bundled runtime (#1693) or uses the design system
 * (#5057).
 *
 * `page.html` is the exact admitted source and never changes. For a page whose source asks for the
 * runtime or uses the design system, the export adds `page.standalone.html`: the same document the
 * renderer frame builds, with the runtime's and the design system's scripts and styles written into
 * its head, so the page looks and works when it is opened from disk with no Colab and no network.
 * Native export writes the same bytes (`rust/tmt-colab/src/export/standalone.rs`);
 * `vectors/export-v1.json` pins both. */
import type { ExportFile } from './export.js';

/** The published name of the derived file, and the file the manifest says it is derived from. */
export const STANDALONE_FILE: ExportFile = 'page.standalone.html';
export const DERIVED_FROM: ExportFile = 'page.html';

/** The renderer frame's policy without its `sandbox` directive, the one a `<meta>` cannot carry:
 * the copy gains no network when it is opened from disk, but it is not sandboxed. The native
 * export holds the same text. */
export const META_POLICY =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; manifest-src 'none'";

/** The theme follows `data-theme` only, so the copy sets it from the system colour scheme and
 * follows changes, the way Colab's own pages follow the app theme. */
export const THEME_SWITCH =
  "(()=>{const q=matchMedia('(prefers-color-scheme: dark)'),r=document.documentElement,s=()=>{r.dataset.theme=q.matches?'dark':'light'};s();q.addEventListener('change',s)})()";

/** The two texts the page runtime adds: every runtime chunk of the build the app was loaded from,
 * in load order, then the seal (#6085), and that build's `assets/colab-runtime.css`. */
export interface StandaloneRuntime {
  readonly script: string;
  readonly style: string;
}
/** The two texts the design system adds (#5057): `script` and `style` of the same build's
 * `assets/colab-page-ui.json`, which are what the renderer frame carries. */
export interface StandaloneDesign {
  readonly script: string;
  readonly style: string;
}
/** What a page that pins a design system adds (#6157), all inert but the binder: the verified
 * bundle's JSON, the page's own pin and the release the export verified (`<version>#<hash>`; for a
 * page that follows a draft, the draft it resolved), whether the page keeps the editorial ramp
 * (it did not ask for the runtime itself), the runtime theme, every runtime chunk's text in load
 * order, and the build's binder, which checks them all when the file opens. */
export interface StandaloneDesignSystem {
  readonly bundle: string;
  readonly pin: string;
  readonly lock: string;
  readonly prose: boolean;
  readonly theme: string;
  readonly chunks: readonly { readonly name: string; readonly text: string }[];
  readonly binder: string;
}
/** Why a page's design system could not be carried: the frame's failure for its pin, a release
 * that could not be read in time, or (native export only) a draft-following page, which needs the
 * browser's draft compiler. */
export type StandaloneDesignReason =
  | 'design-unknown-release'
  | 'design-hash-mismatch'
  | 'design-newer-runtime'
  | 'design-newer-schema'
  | 'design-draft-broken'
  | 'design-release-unavailable'
  | 'design-draft-unavailable';
/** Why a page that needs a standalone copy got none. */
export type StandaloneReason =
  | 'runtime-unavailable'
  | 'runtime-unusable'
  | 'design-unavailable'
  | 'design-unusable'
  | StandaloneDesignReason;
/** What became of the copy; absent for a page that needs none. */
export interface StandaloneOutcome {
  readonly included: boolean;
  readonly reason?: StandaloneReason;
}
/** What the caller found for a page that needs a copy: the runtime and design texts the page asks for
 * that it loaded, or what it could not load. */
export type StandaloneRequest =
  | {
      readonly runtime?: StandaloneRuntime;
      readonly design?: StandaloneDesign;
      readonly designSystem?: StandaloneDesignSystem;
    }
  | { readonly reason: 'runtime-unavailable' | 'design-unavailable' | StandaloneDesignReason };

/** A page uses the design system (#5057) when its source contains `tmt-ui-`, `<tmt-icon` or
 * `tmt-starter`, ignoring ASCII case. A plain text test, with no parsing: it is the test the renderer
 * frame makes to paint the page, and `vectors/design-marker-v1.json` pins this, the frame's and the
 * native export's. The `i` flag without `u` folds only ASCII letters that are in these names. */
export function usesDesign(source: string): boolean {
  return /tmt-ui-|<tmt-icon|tmt-starter/i.test(source);
}

/** A text that could end its own element or open a comment would escape the head block. The build
 * already refuses both; this is the guard. */
function escapes(text: string, closing: RegExp): boolean {
  return text.includes('<!--') || closing.test(text);
}

/** A pin, a lock and a chunk name are written as attribute values; their grammars hold no quote. */
const attribute = /^[A-Za-z0-9_.@#-]{1,256}$/;
/** The design system's head blocks: the bundle and each chunk inert, then the binder. */
function designSystemBlocks(ds: StandaloneDesignSystem): string | undefined {
  if (
    ![ds.pin, ds.lock, ...ds.chunks.map((chunk) => chunk.name)].every((value) =>
      attribute.test(value),
    ) ||
    escapes(ds.binder, /<\/script/i) ||
    escapes(ds.theme, /<\/style/i) ||
    ds.chunks.some((chunk) => escapes(chunk.text, /<\/script/i))
  )
    return undefined;
  const bundle = ds.bundle.replace(/</g, '\\u003c');
  return `<script type="application/json" id="tmt-ds-bundle" data-pin="${ds.pin}" data-lock="${ds.lock}"${ds.prose ? ' data-prose' : ''}>${bundle}</script>${ds.chunks.map((chunk) => `<script type="text/plain" data-chunk="${chunk.name}">${chunk.text}</script>`).join('')}<script>${ds.binder}</script>`;
}

/** The copy's document, or why a text is not safe to write into HTML. The head holds, in order: the
 * design style and the runtime's theme (the frame carries them in that order), the theme switch, then
 * the design script, and then the runtime script, or for a page that pins a design system its inert
 * blocks and the binder that runs the runtime and the components (#6157). A page that needs only the
 * runtime gets the same bytes as before the design system. */
export function standaloneDocument(
  source: string,
  parts: {
    readonly runtime?: StandaloneRuntime;
    readonly design?: StandaloneDesign;
    readonly designSystem?: StandaloneDesignSystem;
  },
): string | { readonly reason: 'runtime-unusable' | 'design-unusable' } {
  const { design, designSystem } = parts;
  // A pinned design system brings every chunk, so the binder runs the runtime in its place.
  const runtime = designSystem ? undefined : parts.runtime;
  const theme = designSystem?.theme ?? runtime?.style;
  if (runtime && (escapes(runtime.script, /<\/script/i) || escapes(runtime.style, /<\/style/i)))
    return { reason: 'runtime-unusable' };
  if (design && (escapes(design.script, /<\/script/i) || escapes(design.style, /<\/style/i)))
    return { reason: 'design-unusable' };
  const blocks = designSystem ? designSystemBlocks(designSystem) : '';
  if (blocks === undefined) return { reason: 'runtime-unusable' };
  return `<!doctype html><html${design ? ' data-colab-design' : ''}><head><meta http-equiv="Content-Security-Policy" content="${META_POLICY}"><meta charset="utf-8">${design ? `<style>${design.style}</style>` : ''}${theme === undefined ? '' : `<style type="text/tailwindcss">${theme}</style>`}<script>${THEME_SWITCH}</script>${design ? `<script>${design.script}</script>` : ''}${runtime ? `<script>${runtime.script}</script>` : ''}${blocks}</head><body>${source}</body></html>`;
}

/** The copy of `source` (a page that needs one) and its outcome. */
export function deriveStandalone(
  source: string,
  request: StandaloneRequest,
): { outcome: StandaloneOutcome; document?: string } {
  if ('reason' in request) return { outcome: { included: false, reason: request.reason } };
  const document = standaloneDocument(source, request);
  return typeof document === 'string'
    ? { outcome: { included: true }, document }
    : { outcome: { included: false, reason: document.reason } };
}
