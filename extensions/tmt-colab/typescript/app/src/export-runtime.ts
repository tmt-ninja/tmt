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
  wantsRuntime,
} from './page-runtime.js';
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
  return {
    bundle: JSON.stringify(bundle),
    pin: pin.lock ? `${pin.system}@${pin.lock.version}#${pin.lock.hash}` : pin.system,
    lock: `${bundle.version}#${bundle.hash}`,
    prose: !wantsRuntime(source),
    ...runtime,
  };
}

/** What the export needs to know about the bundled runtime (#1693) and the design system (#5057,
 * #6157) for one page: what the app was loaded with that the page asks for (an ordinary page that
 * opts in to the runtime, a page that uses the design classes, a page that pins a design system, or
 * a mix), or why there is none. Any other page asks for nothing, so its export stays as it was. The
 * base is the renderer frame's own; `designSystems` is where the page's frame reads its bundle. */
export async function standaloneRequest(
  page: {
    source: string;
    pageType?: string;
  },
  designSystems?: DesignSystemSource,
): Promise<StandaloneRequest | undefined> {
  if (page.pageType === 'shell') return undefined;
  const namedDesign = namesDesignSystem(page.source);
  // A pinned design system brings every chunk, which serves a runtime page as well.
  const wantsRuntimeBundle = !namedDesign && wantsRuntime(page.source);
  const wantsDesign = usesDesign(page.source);
  if (!wantsRuntimeBundle && !wantsDesign && !namedDesign) return undefined;
  const base = rendererBase();
  const [runtime, design, designSystem] = await Promise.allSettled([
    // An exported page has no parent to send it chunks: it carries all of them, in load order,
    // sealed before its own scripts run (#6085).
    wantsRuntimeBundle
      ? loadRuntime(base, allRuntimeChunks()).then((loaded) => {
          if (loaded.scripts.length !== allRuntimeChunks().length)
            throw new Error('Page runtime unavailable');
          return {
            style: loaded.style,
            script: `${loaded.scripts.join('\n')}\nwindow.__colabRuntimeSeal?.();`,
          };
        })
      : undefined,
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
