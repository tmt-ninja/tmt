import { expect, it, vi } from 'vite-plus/test';
import type { PageBinding, PageSnapshot, PageTransport, PageView } from '../src/transport.js';
import { workBundleSource } from '../src/work-bundle-source.js';

it('admits the target page, follows its updates and releases its binding', async () => {
  let change: ((view: PageView) => void) | undefined;
  const stop = vi.fn(),
    close = vi.fn();
  const binding = {
    subscribe: (next: (view: PageView) => void) => {
      change = next;
      return stop;
    },
    close,
  } as unknown as PageBinding;
  const snapshot = {
    id: 'page-1',
    title: 'Initial',
    sharing: 'private',
    source: '',
    binding,
  } as PageSnapshot;
  const transport = {
    page: vi.fn(async () => snapshot),
    spaceHome: vi.fn(async () => ({
      title: 'Space',
      pages: [
        {
          id: 'page-1',
          title: 'Initial',
          sharing: 'private',
          projects: ['gui'],
          summary: { comments: 0, waiting: true, needsYou: 1 },
        },
      ],
    })),
  } as unknown as PageTransport;
  const controller = new AbortController(),
    publish = vi.fn(),
    failed = vi.fn();
  const cleanup = workBundleSource(transport, 'space', (id) => `/pages/${id}`).subscribe(
    'page-1',
    controller.signal,
    publish,
    failed,
  );
  await vi.waitFor(() =>
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Initial',
        href: '/pages/page-1',
        projects: ['gui'],
        needsYou: true,
      }),
    ),
  );
  change?.({ title: 'Updated', source: '', pageState: 'done' } as PageView);
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: 'Updated', stage: 'done' }),
  );
  cleanup();
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(failed).not.toHaveBeenCalled();
});

it('does not read the owner list when the referenced page is refused', async () => {
  const home = vi.fn(),
    failed = vi.fn(),
    publish = vi.fn();
  const transport = {
    page: async () => {
      throw new Error('refused');
    },
    spaceHome: home,
  } as unknown as PageTransport;
  const cleanup = workBundleSource(transport, undefined, (id) => `/pages/${id}`).subscribe(
    'missing',
    new AbortController().signal,
    publish,
    failed,
  );
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(home).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  cleanup();
});

it('closes a late page binding after its consumer has left', async () => {
  let resolve!: (page: PageSnapshot) => void;
  const close = vi.fn(),
    publish = vi.fn(),
    failed = vi.fn();
  const transport = {
    page: () =>
      new Promise<PageSnapshot>((done) => {
        resolve = done;
      }),
    spaceHome: vi.fn(),
  } as unknown as PageTransport;
  const controller = new AbortController();
  workBundleSource(transport, undefined, (id) => `/pages/${id}`).subscribe(
    'page-1',
    controller.signal,
    publish,
    failed,
  );
  controller.abort();
  resolve({
    id: 'page-1',
    title: 'Late',
    sharing: 'private',
    source: '',
    binding: { close } as unknown as PageBinding,
  });
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(publish).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});

it('clears an admitted page and closes its binding when the live subscription fails', async () => {
  let reject!: (error: Error) => void;
  const stop = vi.fn(),
    close = vi.fn(),
    failed = vi.fn(),
    publish = vi.fn();
  const binding = {
    subscribe: (_next: (view: PageView) => void, fail: (error: Error) => void) => {
      reject = fail;
      return stop;
    },
    close,
  } as unknown as PageBinding;
  const transport = {
    page: async () => ({ id: 'page-1', title: 'Initial', sharing: 'private', source: '', binding }),
    spaceHome: async () => ({ title: 'Space', pages: [] }),
  } as unknown as PageTransport;
  const cleanup = workBundleSource(transport, undefined, (id) => `/pages/${id}`).subscribe(
    'page-1',
    new AbortController().signal,
    publish,
    failed,
  );
  await vi.waitFor(() => expect(publish).toHaveBeenCalled());
  reject(new Error('access ended'));
  expect(failed).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  cleanup();
  expect(close).toHaveBeenCalledOnce();
});

it('rejects a mismatched page snapshot and closes its binding', async () => {
  const close = vi.fn(),
    failed = vi.fn(),
    publish = vi.fn(),
    home = vi.fn();
  const transport = {
    page: async () => ({
      id: 'other',
      title: 'Wrong',
      sharing: 'private',
      source: '',
      binding: { close },
    }),
    spaceHome: home,
  } as unknown as PageTransport;
  const cleanup = workBundleSource(transport, undefined, (id) => `/pages/${id}`).subscribe(
    'page-1',
    new AbortController().signal,
    publish,
    failed,
  );
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(close).toHaveBeenCalledOnce();
  expect(publish).not.toHaveBeenCalled();
  expect(home).not.toHaveBeenCalled();
  cleanup();
});

it('closes a binding if subscribing throws and does not read the owner list', async () => {
  const close = vi.fn(),
    failed = vi.fn(),
    home = vi.fn();
  const binding = {
    subscribe: () => {
      throw new Error('subscription unavailable');
    },
    close,
  } as unknown as PageBinding;
  const transport = {
    page: async () => ({ id: 'page-1', title: 'Initial', sharing: 'private', source: '', binding }),
    spaceHome: home,
  } as unknown as PageTransport;
  const cleanup = workBundleSource(transport, undefined, (id) => `/pages/${id}`).subscribe(
    'page-1',
    new AbortController().signal,
    () => {},
    failed,
  );
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(close).toHaveBeenCalledOnce();
  expect(home).not.toHaveBeenCalled();
  cleanup();
  expect(close).toHaveBeenCalledOnce();
});
