import type { WorkBundlePage, WorkBundleSource } from '@tmt/browser-ui/blocks';
import { relativeTime } from './display-time.js';
import { rememberPages, rememberedPages, watchRememberedPages } from './quick-switcher-source.js';
import type {
  PageBinding,
  PageSnapshot,
  PageSummary,
  PageTransport,
  PageView,
} from './transport.js';

/** Check the trusted page's current writer proof at subscription and at every data hand-off. */
export function gateWorkBundleSource(
  source: WorkBundleSource,
  admitted: () => boolean,
): WorkBundleSource {
  return {
    subscribe(page, signal, publish, failed) {
      if (!admitted()) {
        failed();
        return () => {};
      }
      return source.subscribe(
        page,
        signal,
        (value) => {
          if (admitted()) publish(value);
          else failed();
        },
        failed,
      );
    },
  };
}

/** A block may display only data the viewer's existing page transport has admitted. */
export function workBundleSource(
  transport: PageTransport,
  space: string | undefined,
  pageHref: (id: string) => string,
): WorkBundleSource {
  return {
    subscribe(page, signal, publish, failed) {
      const lifetime = new AbortController();
      let snapshot: PageSnapshot | undefined;
      let binding: PageBinding | undefined;
      let view: PageView | undefined;
      let rows: readonly PageSummary[] | undefined = rememberedPages(transport, space);
      let stopBinding: (() => void) | undefined;
      let closed = false;
      const emit = () => {
        if (!snapshot || closed) return;
        const row = rows?.find((item) => item.id === page);
        const summary =
          view?.work?.summary ??
          view?.shell?.summary ??
          snapshot.work?.summary ??
          snapshot.shell?.summary;
        const state =
          view?.pageState ?? snapshot.pageState ?? snapshot.state ?? row?.summary?.work?.stage;
        const timestamp = row?.lastUpdateAtMs;
        const data: WorkBundlePage = {
          title: view?.title ?? snapshot.title,
          href: pageHref(page),
          ...(summary ? { summary: [summary.line1, summary.line2].filter(Boolean).join(' ') } : {}),
          ...(row?.projects ? { projects: row.projects } : {}),
          ...(state ? { stage: state } : {}),
          ...((view?.creator?.agent.name ?? snapshot.creator?.agent.name ?? row?.summary?.author)
            ? {
                owner:
                  view?.creator?.agent.name ?? snapshot.creator?.agent.name ?? row?.summary?.author,
              }
            : {}),
          ...(row?.summary ? { needsYou: row.summary.needsYou > 0 } : {}),
          ...(timestamp != null ? { updated: relativeTime(timestamp, Date.now()) } : {}),
        };
        publish(data);
      };
      const stopRows = watchRememberedPages(transport, space, (next) => {
        rows = next;
        emit();
      });
      const close = () => {
        if (closed) return;
        closed = true;
        lifetime.abort();
        signal.removeEventListener('abort', close);
        stopRows();
        stopBinding?.();
        binding?.close();
        binding = undefined;
      };
      if (signal.aborted) {
        close();
        return close;
      }
      signal.addEventListener('abort', close, { once: true });
      void transport.page(page, lifetime.signal).then(
        (opened) => {
          if (closed) {
            opened.binding?.close();
            return;
          }
          if (opened.id !== page) {
            opened.binding?.close();
            failed();
            return;
          }
          snapshot = opened;
          binding = opened.binding;
          emit();
          if (binding) {
            const unavailable = () => {
              if (closed || !snapshot) return;
              snapshot = undefined;
              const stop = stopBinding;
              stopBinding = undefined;
              const current = binding;
              binding = undefined;
              stop?.();
              current?.close();
              failed();
            };
            try {
              const stop = binding.subscribe((next) => {
                view = next;
                emit();
              }, unavailable);
              if (snapshot) stopBinding = stop;
              else stop();
            } catch {
              unavailable();
              return;
            }
          }
          if (!snapshot) return;
          void transport.spaceHome(lifetime.signal).then(
            (home) => {
              if (!closed) rememberPages(transport, space, home.pages);
            },
            () => {},
          );
        },
        () => {
          if (!closed) failed();
        },
      );
      return close;
    },
  };
}
