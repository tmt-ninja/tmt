/**
 * The standalone copy's binder (#6157): built as `assets/colab-standalone-binder.js` from the frame's
 * own modules, so a copy binds its design system the way the renderer frame does. The export writes
 * inert blocks into the copy's head (they never run): each page runtime chunk the page needs as
 * `<script type="text/plain" data-chunk>`, and the verified bundle as
 * `<script type="application/json" id="tmt-ds-bundle" data-pin data-lock>`. This script runs after
 * them, while the head parses, and checks everything before it runs:
 *
 * - each chunk's SHA-256 against this build's chunks. A lazy chunk that fails its check is left
 *   out, so only the components that need it draw "Part unavailable"; a failed base defines no
 *   component and shows the notice.
 * - the bundle's own hash against `data-lock`, the release the export verified. A page that locks a
 *   release must lock that one. A failure shows the frame's notice and defines no component.
 * - the terminal renderer, when the copy carries it (`<script type="application/octet-stream"
 *   data-terminal>`, base64), against this build's pinned length and SHA-256. Only verified bytes
 *   are handed to the terminal chunk, once, as the frame hands them; otherwise a TerminalFrame
 *   stays in its failed state and the page says it is unavailable.
 *
 * Then it writes the chunks, the seal, and `frameDesignSystem` of the bundle as inline scripts; the
 * page check's findings follow once the body has parsed. The copy's policy is the frame's; nothing
 * here fetches.
 */
import {
  bodyElements,
  bundleBody,
  checkPageElements,
  findingsScript,
  frameDesignSystem,
  noticeFrame,
  parsePin,
  verifyRelease,
  type DesignSystemBundle,
  type FrameDesignSystem,
} from './design-system.js';
import type { Bundle } from '../../../../../design/systems/compiler.mjs';
import { sha256Hex } from './sha256.js';

/** This build's runtime chunks, in load order, with their SHA-256 (the runtime build writes them). */
declare const __COLAB_RUNTIME_CHUNKS__: readonly {
  readonly name: string;
  readonly sha256: string;
}[];
/** The editorial layer a page that did not ask for the runtime keeps for its text (#5917). */
declare const __COLAB_DS_PROSE__: string;
/** This build's pinned terminal renderer: its length and SHA-256 (the runtime build writes them). */
declare const __COLAB_TERMINAL_WASM__: { readonly length: number; readonly sha256: string };

const encoder = new TextEncoder();
const head = document.head;
const write = (tag: 'script' | 'style', text: string) => {
  const element = document.createElement(tag);
  element.textContent = text;
  head.append(element);
  return element;
};
const notice = (frame: FrameDesignSystem) => write('script', frame.script);

const block = document.getElementById('tmt-ds-bundle');
const chunkText = (name: string) =>
  head.querySelector(`script[type="text/plain"][data-chunk="${name}"]`)?.textContent ?? undefined;
const verified = __COLAB_RUNTIME_CHUNKS__.flatMap(({ name, sha256 }) => {
  const text = chunkText(name);
  return text !== undefined && sha256Hex(encoder.encode(text)) === sha256 ? [{ name, text }] : [];
});

/** The carried terminal renderer, only when its bytes are exactly this build's. */
const terminal = ((): ArrayBuffer | undefined => {
  const text = head.querySelector(
    'script[type="application/octet-stream"][data-terminal]',
  )?.textContent;
  if (!text) return undefined;
  try {
    const binary = atob(text);
    if (binary.length !== __COLAB_TERMINAL_WASM__.length) return undefined;
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return sha256Hex(bytes) === __COLAB_TERMINAL_WASM__.sha256 ? bytes.buffer : undefined;
  } catch {
    return undefined;
  }
})();

const bind = (): FrameDesignSystem | undefined => {
  if (!block) return undefined;
  if (verified[0]?.name !== 'base') return noticeFrame('runtime-mismatch');
  const pin = parsePin(block.dataset.pin);
  const lock = parsePin(`${pin?.system ?? ''}@${block.dataset.lock ?? ''}`)?.lock;
  if (!pin || !lock) return noticeFrame('unknown-release');
  if (pin.lock && (pin.lock.version !== lock.version || pin.lock.hash !== lock.hash))
    return noticeFrame('hash-mismatch');
  let bundle: DesignSystemBundle | undefined;
  try {
    bundle = JSON.parse(block.textContent ?? '') as DesignSystemBundle;
  } catch {
    return noticeFrame('unknown-release');
  }
  const checked = verifyRelease(
    bundle,
    lock,
    (body) => `sha256-${sha256Hex(encoder.encode(bundleBody(body)))}`,
  );
  if (typeof checked === 'string') return noticeFrame(checked);
  try {
    const frame = frameDesignSystem(checked, pin);
    // The page check reads the body as it parsed, before any component draws into it. A page that
    // writes a TerminalFrame without verified renderer bytes says so.
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const elements = bodyElements(document.body);
        const terminalTags = new Set(
          checked.components
            .filter((component) => component.uiParts?.includes('TerminalFrame'))
            .map((component) => component.tag),
        );
        if (!terminal && elements.some((element) => terminalTags.has(element.tag))) {
          const line = document.createElement('p');
          line.setAttribute('role', 'status');
          line.setAttribute('data-colab-standalone-notice', '');
          line.textContent = 'TerminalFrame is unavailable in standalone export.';
          document.body.prepend(line);
        }
        write(
          'script',
          findingsScript(checkPageElements(elements, pin, checked as unknown as Bundle)),
        );
      },
      { once: true },
    );
    return frame;
  } catch {
    return noticeFrame('newer-runtime');
  }
};

// The chunks run in load order, each as its own script, then the seal closes the runtime's
// registration before the design system and the page's own scripts run, as in the frame. Without
// a verified base no chunk can register, so none runs.
const runtime = verified[0]?.name === 'base' ? verified : [];
// The terminal chunk takes the verified bytes once, as it does in the frame; the seal removes the
// hook before the design system or the page's own scripts run.
if (terminal && runtime.length)
  Object.assign(window, {
    __colabTakeTerminalBytes: () => {
      delete (window as { __colabTakeTerminalBytes?: unknown }).__colabTakeTerminalBytes;
      return terminal;
    },
  });
for (const { text } of runtime) write('script', text);
write(
  'script',
  'window.__colabRuntimeSeal?.();delete window.__colabRuntimeSeal;delete window.__colabTakeTerminalBytes;',
);
const design = bind();
if (design?.failure) notice(design);
else if (design) {
  write('script', 'delete window.__colabBlockData;');
  if (block?.hasAttribute('data-prose')) write('style', __COLAB_DS_PROSE__);
  write('style', design.style).setAttribute('data-colab-design-style', '');
  write('script', design.script);
}
