import { rendererBase } from './entry.js';
import { namesDesignSystem } from './design-system.js';
import { allRuntimeChunks, loadDesign, loadRuntime, wantsRuntime } from './page-runtime.js';
import { usesDesign, type StandaloneRequest } from './standalone.js';

/** What the export needs to know about the bundled runtime (#1693) and the design system (#5057) for
 * one page: what the app was loaded with that the page asks for (an ordinary page that opts in to the
 * runtime, a page that uses the design system, or both), or why there is none. Any other page asks for
 * nothing, so its export stays as it was. The base is the renderer frame's own. */
export async function standaloneRequest(page: {
  source: string;
  pageType?: string;
}): Promise<StandaloneRequest | undefined> {
  if (page.pageType === 'shell') return undefined;
  const wantsRuntimeBundle = wantsRuntime(page.source);
  const wantsDesign = usesDesign(page.source);
  const namedDesign = namesDesignSystem(page.source);
  if (!wantsRuntimeBundle && !wantsDesign && !namedDesign) return undefined;
  const base = rendererBase();
  const [runtime, design] = await Promise.allSettled([
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
  ]);
  if (runtime.status === 'rejected') return { reason: 'runtime-unavailable' };
  if (design.status === 'rejected') return { reason: 'design-unavailable' };
  return {
    ...(namedDesign ? { namedDesign: true } : {}),
    ...(runtime.value === undefined ? {} : { runtime: runtime.value }),
    ...(design.value === undefined ? {} : { design: design.value }),
  };
}
