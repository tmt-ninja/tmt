import { rendererBase } from './entry.js';
import {
  designSystemPin,
  namesDesignSystem,
  pinnedBundle,
  type DesignSystemSource,
} from './design-system.js';
import {
  allRuntimeChunks,
  loadDesign,
  loadRuntime,
  loadStandaloneRuntime,
  loadStandaloneTerminal,
  hasRuntimeMarker,
  wantsReact,
} from './page-runtime.js';
import { carriesTerminal } from './runtime-chunks.js';
import { usesDesign, type StandaloneDesignSystem, type StandaloneRequest } from './standalone.js';

/** The design system a page pins (#6157), resolved and verified as the frame resolves it, with the
 * runtime its copy carries; or why it cannot be carried. A draft-following page carries the draft
 * it resolved, locked by `lock` to what the author saw. */
async function pinnedDesignSystem(
  source: string,
  base: string,
  from: DesignSystemSource | undefined,
): Promise<
  StandaloneDesignSystem | { reason: Extract<StandaloneRequest, { reason: string }>['reason'] }
> {
  const pin = designSystemPin(source);
  if (!pin || !from) return { reason: 'design-unknown-release' };
  const bundle = await pinnedBundle(pin, from);
  if ('failure' in bundle)
    return {
      reason:
        bundle.failure === 'unavailable' || bundle.failure === 'runtime-mismatch'
          ? 'design-release-unavailable'
          : `design-${bundle.failure}`,
    };
  const runtime = await loadStandaloneRuntime(base).catch(() => undefined);
  if (!runtime) return { reason: 'runtime-unavailable' };
  // The terminal renderer rides along only for a page that draws a TerminalFrame; if it cannot be
  // read, the copy is still made and that component shows its failed state.
  const tags = new Set(
    [...new DOMParser().parseFromString(source, 'text/html').querySelectorAll('*')].map(
      (element) => element.localName,
    ),
  );
  const terminal = carriesTerminal(bundle, tags)
    ? await loadStandaloneTerminal(base).catch(() => undefined)
    : undefined;
  return {
    bundle: JSON.stringify(bundle),
    pin: pin.lock ? `${pin.system}@${pin.lock.version}#${pin.lock.hash}` : pin.system,
    lock: `${bundle.version}#${bundle.hash}`,
    prose: !hasRuntimeMarker(source),
    ...runtime,
    ...(terminal === undefined ? {} : { terminal }),
  };
}

/** What the export needs to know about the bundled runtime (#1693, #6077) and the design system
 * (#5057, #6157) for one page: what the app was loaded with that the page needs, or why there is
 * none. Every page compiles Tailwind's utilities, so every page but a shell gets a copy: the
 * runtime's base and theme, all of the runtime for a page that asks for React, the design files for
 * a page that uses the design classes, and a pinned design system with its binder. The base is the
 * renderer frame's own; `designSystems` is where the page's frame reads its bundle. */
export async function standaloneRequest(
  page: {
    source: string;
    pageType?: string;
  },
  designSystems?: DesignSystemSource,
): Promise<StandaloneRequest | undefined> {
  if (page.pageType === 'shell') return undefined;
  const namedDesign = namesDesignSystem(page.source);
  // A pinned design system brings every chunk, which serves a React page as well.
  const react = !namedDesign && wantsReact(page.source);
  const wantsDesign = usesDesign(page.source);
  const base = rendererBase();
  // An exported page has no parent to send it chunks: a React page carries all of them, any other
  // page the base alone, in load order, sealed before its own scripts run (#6085).
  const names = react ? allRuntimeChunks() : ['base'];
  const [runtime, design, designSystem] = await Promise.allSettled([
    namedDesign
      ? undefined
      : loadRuntime(base, names).then((loaded) => {
          if (loaded.scripts.length !== names.length) throw new Error('Page runtime unavailable');
          return {
            style: loaded.style,
            script: `${loaded.scripts.join('\n')}\nwindow.__colabRuntimeSeal?.();`,
          };
        }),
    wantsDesign ? loadDesign(base) : undefined,
    namedDesign ? pinnedDesignSystem(page.source, base, designSystems) : undefined,
  ]);
  if (runtime.status === 'rejected') return { reason: 'runtime-unavailable' };
  if (design.status === 'rejected') return { reason: 'design-unavailable' };
  if (designSystem.status === 'rejected') return { reason: 'design-unavailable' };
  if (designSystem.value && 'reason' in designSystem.value)
    return { reason: designSystem.value.reason };
  return {
    ...(runtime.value === undefined ? {} : { runtime: runtime.value }),
    ...(design.value === undefined ? {} : { design: design.value }),
    ...(designSystem.value === undefined ? {} : { designSystem: designSystem.value }),
  };
}
