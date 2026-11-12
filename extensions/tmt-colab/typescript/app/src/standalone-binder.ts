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
    // The page check reads the body as it parsed, before any component draws into it. The copy
    // carries no terminal renderer yet (#6150), so a page that writes a TerminalFrame says so.
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        const elements = bodyElements(document.body);
        const terminal = new Set(
          checked.components
            .filter((component) => component.uiParts?.includes('TerminalFrame'))
            .map((component) => component.tag),
        );
        if (elements.some((element) => terminal.has(element.tag))) {
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
for (const { text } of runtime) write('script', text);
write('script', 'window.__colabRuntimeSeal?.();delete window.__colabRuntimeSeal;');
const design = bind();
if (design?.failure) notice(design);
else if (design) {
  write('script', 'delete window.__colabBlockData;');
  if (block?.hasAttribute('data-prose')) write('style', __COLAB_DS_PROSE__);
  write('style', design.style).setAttribute('data-colab-design-style', '');
  write('script', design.script);
}
