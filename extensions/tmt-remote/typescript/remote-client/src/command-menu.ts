import { mountBrowserMenu, type BrowserMenuHostOptions } from '@tmt/browser-ui/menu-host';
import { singleCommand, type CommandRun } from './command-run.js';
import { el } from './ops-parts.js';

function entireCaptionVisible(code: HTMLElement): boolean {
  const surface = code.closest('dialog');
  if (!surface) return false;
  const caption = code.getBoundingClientRect();
  const bounds = surface.getBoundingClientRect();
  return (
    caption.width > 0 &&
    caption.height > 0 &&
    code.scrollWidth <= code.clientWidth &&
    caption.top >= Math.max(0, bounds.top) &&
    caption.left >= Math.max(0, bounds.left) &&
    caption.bottom <= Math.min(window.innerHeight, bounds.bottom) &&
    caption.right <= Math.min(window.innerWidth, bounds.right)
  );
}

export function commandMenu(
  shown: string,
  command: string,
  author: string,
  member: string,
  run?: CommandRun,
) {
  const host = el('span', 'ops-dm-command');
  const description = el('span', 'ops-dm-command-description');
  const code = el('code', undefined, command);
  description.append(el('strong', undefined, 'Command'), code);
  const status = el('span', 'ops-dm-command-status');
  status.setAttribute('role', 'status');
  const copy = { key: 'copy', label: 'Copy command' };
  let cycle = 0;
  let held = false;
  let verifiedSelection = false;
  const options: BrowserMenuHostOptions = {
    label: `Command: ${shown}`,
    triggerText: shown,
    presentation: 'compact',
    description,
    items: [copy],
    onOpenChange(open) {
      const version = ++cycle;
      if (!open) return;
      menu.update(options);
      if (!run || held || !singleCommand(command)) return;
      void run
        .options(author, member)
        .then((items) => {
          if (version !== cycle || !host.isConnected || !entireCaptionVisible(code)) return;
          menu.update({ ...options, items: [...items, copy] });
          if (!entireCaptionVisible(code)) menu.update(options);
        })
        .catch(() => {});
    },
    onSelect(key) {
      if (key === 'copy') {
        void (async () => {
          try {
            await navigator.clipboard.writeText(command);
            status.textContent = 'Command copied.';
          } catch {
            status.textContent = 'Could not copy the command.';
          }
        })();
        return;
      }
      if (!run || !verifiedSelection || held) return;
      held = true;
      status.textContent = 'Submitting command…';
      void run.submit(author, command, key).then(
        (state) => {
          held = state === 'unconfirmed';
          status.textContent =
            state === 'submitted'
              ? 'Command submitted.'
              : state === 'refused'
                ? 'Command refused.'
                : 'Command submission unconfirmed.';
        },
        () => {
          status.textContent = 'Command submission unconfirmed.';
        },
      );
    },
  };
  const menu = mountBrowserMenu(host, options);
  // The common menu closes before onSelect, so check the visible caption before its click handler.
  host.addEventListener(
    'click',
    () => {
      verifiedSelection = entireCaptionVisible(code);
    },
    { capture: true },
  );
  host.append(status);
  return host;
}
