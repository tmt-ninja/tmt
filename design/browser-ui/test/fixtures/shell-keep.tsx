import { startShellHost, type ShellRoute, type ShellSlot } from '../../src/shell-host.js';
import '../../generated/static.css';

/** A route whose module records its lifecycle; `keep` modules can be suspended. */
function scaffold() {
  const root = document.createElement('div');
  root.className = 'tmt-ui-shell';
  root.innerHTML =
    '<div class="tmt-ui-shell-content"><div class="tmt-ui-shell-bar"></div><div class="tmt-ui-shell-main"></div></div>';
  document.body.append(root);
  return root;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(options: { keep: readonly string[]; failSuspend?: string; failResume?: string }) {
  const log: string[] = [];
  const slots = new Map<string, ShellSlot>();
  let sessions = 0;
  let session: object | undefined;
  const routes: ShellRoute[] = ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    paths: [`/keep-${id}/`],
    rail: 'home',
    quiet: true,
    keep: options.keep.includes(id),
    load: async () => ({
      mount(slot) {
        log.push(`mount ${id}`);
        slots.set(id, slot);
        const node = document.createElement('p');
        node.textContent = `content ${id}`;
        // A frame reloads if it is ever removed or moved: the kept module's area stays in place.
        const frame = document.createElement('iframe');
        frame.srcdoc = `<p>${id}</p>`;
        slot.main.append(node, frame);
        slot.setTitle(id);
        if (!options.keep.includes(id)) return () => log.push(`release ${id}`);
        return {
          release: () => log.push(`release ${id}`),
          suspend() {
            if (options.failSuspend === id) throw new Error('suspend failed');
            log.push(`suspend ${id}`);
          },
          resume(next) {
            if (options.failResume === id) throw new Error('resume failed');
            slots.set(id, next);
            log.push(`resume ${id}`);
          },
        };
      },
    }),
  }));
  const root = scaffold();
  history.replaceState(null, '', '/keep-a/');
  const host = startShellHost(root, routes, {
    sessions: {
      async open() {
        if (!session) {
          sessions++;
          session = {};
        }
        return session;
      },
      forget(previous) {
        log.push('forget');
        if (session === previous) session = undefined;
      },
    },
  });
  const go = async (id: string) => {
    host.navigate(`/keep-${id}/`);
    await settle();
    await settle();
  };
  /** The text of whichever main area shows. */
  const main = () =>
    [...root.querySelectorAll<HTMLElement>('.tmt-ui-shell-main')]
      .filter((area) => !area.hidden)
      .map((area) => area.textContent)
      .join('|');
  return { log, slots, host, root, go, main, sessions: () => sessions };
}

/** Suspend on leave, resume (not mount) on return, with its nodes and title back. */
export async function keepsAndResumes() {
  const { log, host, root, go, main, slots, sessions } = harness({ keep: ['a'] });
  try {
    await settle();
    await settle();
    const first = await slots.get('a')!.session();
    const frame = root.querySelector('iframe')!;
    await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    (frame.contentWindow as Window & { marker?: string }).marker = 'kept';
    let loads = 0;
    frame.addEventListener('load', () => loads++);
    await go('b');
    const away = main();
    const hidden = { hidden: frame.parentElement!.hidden, inert: frame.parentElement!.inert };
    await go('a');
    const back = main();
    const sameFrame =
      root.querySelector('iframe') === frame &&
      (frame.contentWindow as Window & { marker?: string }).marker === 'kept' &&
      loads === 0;
    const title = document.title;
    const second = await slots.get('a')!.session();
    await go('c');
    return {
      log: [...log],
      away,
      hidden,
      back,
      sameFrame,
      title,
      sameSession: first === second,
      sessions: sessions(),
    };
  } finally {
    host.dispose();
    root.remove();
  }
}

/** One per route, two in all: the least recently used one is released. */
export async function boundsKept() {
  const { log, host, root, go } = harness({ keep: ['a', 'b', 'c'] });
  try {
    await settle();
    await settle();
    await go('b');
    await go('c');
    await go('d');
    const afterCap = [...log];
    host.dispose();
    return { afterCap, afterDispose: log.slice(afterCap.length) };
  } finally {
    root.remove();
  }
}

/** A failed suspend or resume releases the module; the next visit mounts it afresh. */
export async function failuresRelease() {
  const suspend = harness({ keep: ['a'], failSuspend: 'a' });
  const resume = harness({ keep: ['a'], failResume: 'a' });
  try {
    for (const run of [suspend, resume]) {
      await settle();
      await settle();
      await run.go('b');
      await run.go('a');
    }
    return { suspend: [...suspend.log], resume: [...resume.log], main: resume.main() };
  } finally {
    for (const run of [suspend, resume]) {
      run.host.dispose();
      run.root.remove();
    }
  }
}

/** A session change releases suspended modules before forgetting; a released one never resumes. */
export async function sessionChangeReleasesFirst() {
  const { log, host, root, go, slots, sessions } = harness({ keep: ['a'] });
  try {
    await settle();
    await settle();
    const old = await slots.get('a')!.session();
    await go('b');
    slots.get('b')!.forgetSession(old);
    const order = [...log];
    await go('a');
    const fresh = await slots.get('a')!.session();
    host.sessionChanging();
    return { order, after: log.slice(order.length), renewed: fresh !== old, sessions: sessions() };
  } finally {
    host.dispose();
    root.remove();
  }
}

/** `pagehide` releases what is kept. */
export async function pagehideReleases() {
  const { log, host, root, go } = harness({ keep: ['a'] });
  try {
    await settle();
    await settle();
    await go('b');
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return [...log];
  } finally {
    host.dispose();
    root.remove();
  }
}
