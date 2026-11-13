/** The Ops message box slot (#5704): loads the composer island on first use and holds its place
 * with a still box of the same height until it arrives. */
import { el } from './ops-parts.js';
import type { ComposerHandle, ComposerOptions } from './ops-composer-types.js';

/** The composer's own module, served beside the SDK (see vite.composer.config.ts). */
const COMPOSER = '/sdk/ops-composer-v1.js';
/** The composer is a lazily loaded React island, so pages that never open a channel skip it. */
export function composerSlot(host: HTMLElement) {
  let handle: ComposerHandle | undefined;
  let wanted: ComposerOptions | undefined;
  let loading = false;
  return {
    show(options: ComposerOptions) {
      wanted = options;
      if (handle) return handle.update(options);
      if (loading) return;
      loading = true;
      // Until the module arrives, a still box of the same height holds the place, so nothing jumps.
      const still = el('div', 'ops-composer-still');
      still.setAttribute('aria-hidden', 'true');
      still.append(el('span', 'ops-composer-still-text', options.placeholder));
      host.replaceChildren(still);
      void import(/* @vite-ignore */ COMPOSER).then(
        ({
          mountComposer,
        }: {
          mountComposer: (host: HTMLElement, options: ComposerOptions) => ComposerHandle;
        }) => {
          handle = mountComposer(host, wanted!);
        },
        () => {
          host.replaceChildren(
            el('p', 'ops-empty', 'The message box could not load. Reload the page to try again.'),
          );
        },
      );
    },
  };
}
