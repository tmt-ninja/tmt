/**
 * Colab as a route of the one TMT web app (#3937): the host imports this from Colab's own mount
 * and mounts it into its shell at `/colab/...`. The host owns the rail; Colab renders its header
 * into the host's slot and gives the host its module menu. Leaving the route suspends it (the
 * shell keeps it); releasing it closes the page bindings and the React root.
 */
import { Activity, StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { probeCapabilities } from '@tmt/colab-client';
import { moduleMount } from '@tmt/browser-ui/shell';
import type { ShellMounted, ShellSlot } from '@tmt/browser-ui/shell-host';
import { ColabModuleBoundary } from './colab-module-boundary.js';
import '@tmt/browser-ui/static.css';
import './style.css';
import { ShellHostSlot } from './colab-shell.js';
import { hostInShell, mountOfModule } from './entry.js';
import { previewTransport } from './local-pages.js';
import { MountedView } from './mounted-app.js';
import { startMounted } from './mounted-runtime.js';
import { UnsupportedBrowserNotice } from './notice-card.js';
import { createAppRouter, shellLocation } from './router.js';
import {
  mount as mountSearchEntry,
  type SearchEntry,
  type SearchEntryOptions,
} from './search-entry.js';
import { createSearchSession, type SearchSessionOptions } from './search-session.js';
import { mountedTransport } from './mounted.js';

/** The paired mount the composed shell names for Colab, or null for the local preview. */
function pairedMount(slot: ShellSlot): URL | null {
  const colab = slot.answer()?.modules.find((module) => module.extension === 'colab');
  if (!colab) return null;
  const mount = new URL(colab.rail.path, location.href);
  return mount.origin === location.origin && moduleMount(mount.pathname) === 'colab' ? mount : null;
}

/**
 * Link the built module's stylesheet, beside it under the mount (the dev server injects styles).
 * `remove` takes it away again (nothing when the page already had it before this mount); `pause`
 * turns it off while Colab is suspended, so its rules never reach another route, without reloading.
 */
function stylesheet(): { remove(): void; pause(paused: boolean): void } {
  const none = { remove() {}, pause() {} };
  if (import.meta.env.DEV) return none;
  const href = new URL('./colab-module.css', import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return none;
  const link = document.head.appendChild(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href }),
  );
  return {
    remove: () => link.remove(),
    pause: (paused) => (link.disabled = paused),
  };
}

/**
 * The global search's Colab half (#4841), mounted by the shell off the Colab route: it links this
 * module's stylesheet for as long as the search lives and adds no shortcut listener of its own.
 */
export function mountSearch(container: HTMLElement, options: SearchEntryOptions): SearchEntry {
  const style = stylesheet();
  const entry = mountSearchEntry(container, options);
  return {
    open: entry.open,
    dispose() {
      entry.dispose();
      style.remove();
    },
  };
}

/**
 * The global search for a host that builds no page transport (#5267): the session owns Colab's
 * mounted transport and its close, so the host never touches either. It starts when mounted;
 * `open` before the pages are ready opens the dialog on the groups that are, and `dispose` ends
 * the transport, a bootstrap still running included.
 */
export function mountSearchSession(
  container: HTMLElement,
  options: SearchSessionOptions,
): SearchEntry {
  const style = stylesheet();
  const session = createSearchSession(
    {
      // The document is another module's: name the mount this script was loaded from, so discovery
      // never reads or rewrites the location.
      admit: (signal) => {
        const mount = mountOfModule(import.meta.url);
        return mount
          ? mountedTransport(signal, { mount })
          : Promise.reject(new Error('Colab was not loaded from its mount'));
      },
      mountEntry: mountSearchEntry,
      page: window,
    },
    container,
    options,
  );
  return {
    open: session.open,
    dispose() {
      session.dispose();
      style.remove();
    },
  };
}

export async function mount(slot: ShellSlot): Promise<ShellMounted | (() => void)> {
  const style = stylesheet();
  const host = document.createElement('div');
  host.className = 'colab-route';
  slot.main.replaceChildren(host);
  const root = createRoot(host);
  try {
    await probeCapabilities();
  } catch {
    root.render(<UnsupportedBrowserNotice />);
    return () => {
      root.unmount();
      style.remove();
    };
  }
  const paired = pairedMount(slot);
  hostInShell(paired);
  shellLocation();
  slot.setTitle('Colab');
  // The paired runtime outlives a rail switch: the shell keeps this module suspended, so coming
  // back shows the last page without opening the session, registering or discovering again
  // (#5954). It uses the shell's one session for this tab.
  let latest = slot;
  let readyWhenSuspended: boolean | undefined;
  const runtime = paired
    ? startMounted({
        session: {
          open: (signal) => latest.session(signal),
          forget: (previous) => latest.forgetSession(previous),
        },
      })
    : null;
  const preview = paired ? null : createAppRouter(previewTransport);
  // One tree for the module's whole life, over a slot that forwards to the host's latest one: a
  // resume reveals the same elements, so React neither renders the tree again nor touches what it
  // drew into the shell; revealing re-runs its effects, which adopt the shell's new top bar.
  const live: ShellSlot = {
    get main() {
      return latest.main;
    },
    get bar() {
      return latest.bar;
    },
    get tools() {
      return latest.tools;
    },
    get basePath() {
      return latest.basePath;
    },
    // While suspended the host's slot is no longer current and would answer false; a hidden tree
    // that renders a late update must still choose the shared bar it was drawn with.
    topBarReady: () => readyWhenSuspended ?? latest.topBarReady(),
    setTopBar: () => latest.setTopBar(),
    answer: () => latest.answer(),
    setMenu: (menu, select) => latest.setMenu(menu, select),
    setTitle: (title) => latest.setTitle(title),
    navigate: (href, options) => latest.navigate(href, options),
    describe: (address) => latest.describe(address),
    described: (listener) => latest.described(listener),
    session: (signal) => latest.session(signal),
    forgetSession: (previous) => latest.forgetSession(previous),
  };
  const shown = (
    <ColabModuleBoundary slot={live}>
      <ShellHostSlot value={live}>
        {runtime ? <MountedView runtime={runtime} /> : <RouterProvider router={preview!} />}
      </ShellHostSlot>
    </ColabModuleBoundary>
  );
  const render = (mode: 'visible' | 'hidden') =>
    root.render(
      <StrictMode>
        {/* Hidden, Colab's effects end (timers, observers, subscriptions) and nothing is drawn;
            its state and the runtime's sockets stay. */}
        <Activity mode={mode}>{shown}</Activity>
      </StrictMode>,
    );
  render('visible');
  return {
    release() {
      root.unmount();
      runtime?.close();
      style.remove();
    },
    suspend() {
      readyWhenSuspended = latest.topBarReady();
      flushSync(() => render('hidden'));
      style.pause(true);
    },
    resume(next) {
      style.pause(false);
      latest = next;
      readyWhenSuspended = undefined;
      hostInShell(paired);
      shellLocation();
      flushSync(() => render('visible'));
      // The rail may have brought Colab back at another of its pages: its router follows history
      // through popstate, as on Back, now that its listeners are attached again.
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
  };
}
