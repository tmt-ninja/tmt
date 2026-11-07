import { pageAction } from '../test/page-actions.js';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pairBrowser, startDoor } from './harness/browser.js';
import { patchArgs, createPage, freePort, openPage, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';

// #1627 slice B: the CLI combines its own tail into a checkpoint, so a page takes far more than
// 200 changes, the browser still opens and edits it, and the exact source survives everywhere.
const MIB = 1024 * 1024;
// Project synthetic traces before they leave the private runner: never retain URLs, source,
// arbitrary arguments or unknown script names in the public acceptance artifact.
async function traceLargeWrites(page: Page, name: string) {
  if (!process.env.RUNNER_TEMP) return async () => {};
  const client = await page.context().newCDPSession(page);
  const events: Record<string, unknown>[] = [];
  const modules = new Set(['renderer.html']);
  if (process.env.TMT_COLAB_APP_DIR) {
    for (const file of fs.readdirSync(path.join(process.env.TMT_COLAB_APP_DIR, 'assets'))) {
      if (/^[A-Za-z0-9_-]{1,80}\.js$/.test(file)) modules.add(file);
    }
  }
  const moduleName = (value: unknown) => {
    try {
      const file = path.posix.basename(new URL(String(value)).pathname);
      return modules.has(file) ? file : '';
    } catch {
      return '';
    }
  };
  const functionName = (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z_$][\w.$]{0,63}$/.test(value) ? value : undefined;
  const allowed = new Set([
    'RunTask',
    'ThreadControllerImpl::RunTask',
    'ThreadPool_RunTask',
    'RunMicrotasks',
    'FunctionCall',
    'EvaluateScript',
    'EventDispatch',
    'FireAnimationFrame',
    'TimerFire',
    'TimeStamp',
    'Layout',
    'UpdateLayoutTree',
    'PrePaint',
    'Paint',
    'ParseHTML',
    'V8.Execute',
    'V8.HandleInterrupts',
    'V8.BytecodeBudgetInterrupt',
    'V8.BytecodeBudgetInterruptWithStackCheck',
    'MinorGC',
    'MajorGC',
    'V8.GCScavenger',
    'V8.GCFinalizeMC',
    'Profile',
    'ProfileChunk',
  ]);
  let truncated = false;
  client.on('Tracing.dataCollected', ({ value }) => {
    for (const item of value) {
      if (!allowed.has(item.name) || typeof item.ts !== 'number') continue;
      if (events.length >= 100_000) {
        truncated = true;
        continue;
      }
      const args = item.args as unknown as {
        data?: {
          url?: unknown;
          functionName?: unknown;
          message?: unknown;
          startTime?: unknown;
          cpuProfile?: { nodes?: unknown; samples?: unknown };
          timeDeltas?: unknown;
          stackTrace?: unknown;
        };
        beginData?: { stackTrace?: unknown };
      };
      const data = args?.data;
      if (item.name === 'TimeStamp' && data?.message !== 'colab-large-start') continue;
      const module = moduleName(data?.url);
      const fn = module ? functionName(data?.functionName) : undefined;
      const numbers = (value: unknown) =>
        Array.isArray(value) ? value.slice(0, 10_000).filter(Number.isSafeInteger) : [];
      const rawId = (item as unknown as { id?: unknown }).id;
      const profileId =
        typeof rawId === 'string' && /^(?:0x)?[0-9a-f]{1,16}$/i.test(rawId) ? rawId : undefined;
      const rawStack = args?.beginData?.stackTrace ?? data?.stackTrace;
      const stack = Array.isArray(rawStack)
        ? rawStack.slice(0, 64).flatMap((value: unknown) => {
            if (!value || typeof value !== 'object') return [];
            const frame = value as { url?: unknown; functionName?: unknown };
            const own = moduleName(frame.url);
            const fn = own ? functionName(frame.functionName) : undefined;
            return own && fn ? [{ module: own, function: fn }] : [];
          })
        : [];
      const nodes = Array.isArray(data?.cpuProfile?.nodes)
        ? data.cpuProfile.nodes.slice(0, 10_000).flatMap((node: unknown) => {
            if (!node || typeof node !== 'object') return [];
            const n = node as {
              id?: unknown;
              parent?: unknown;
              callFrame?: { url?: unknown; functionName?: unknown };
            };
            if (!Number.isSafeInteger(n.id)) return [];
            const own = moduleName(n.callFrame?.url);
            const label = own ? functionName(n.callFrame?.functionName) : undefined;
            const builtin = n.callFrame?.functionName === '(garbage collector)' ? 'GC' : undefined;
            return [
              {
                id: n.id,
                ...(Number.isSafeInteger(n.parent) ? { parent: n.parent } : {}),
                ...(own ? { module: own } : {}),
                ...(label || builtin ? { function: label || builtin } : {}),
              },
            ];
          })
        : undefined;
      events.push({
        name: item.name,
        ph: item.ph,
        ts: item.ts,
        dur: item.dur,
        pid: item.pid,
        tid: item.tid,
        ...(profileId ? { profileId } : {}),
        ...(stack.length ? { stack } : {}),
        ...(module ? { module } : {}),
        ...(fn ? { function: fn } : {}),
        ...(typeof data?.startTime === 'number' ? { startTime: data.startTime } : {}),
        ...(nodes
          ? {
              nodes,
              samples: numbers(data?.cpuProfile?.samples),
              timeDeltas: numbers(data?.timeDeltas),
            }
          : {}),
      });
    }
  });
  await client.send('Tracing.start', {
    categories:
      'toplevel,devtools.timeline,v8.execute,disabled-by-default-devtools.timeline.stack,disabled-by-default-v8.cpu_profiler',
    transferMode: 'ReportEvents',
  });
  return async () => {
    let incomplete = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const complete = new Promise<void>((resolve) =>
      client.once('Tracing.tracingComplete', () => resolve()),
    );
    try {
      await Promise.race([
        client.send('Tracing.end').then(() => complete),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Trace cleanup timed out')), 3_000);
        }),
      ]);
      incomplete = false;
    } catch {
      // An interrupted page can close its session before Chrome returns the remaining events.
    } finally {
      clearTimeout(timer);
      const out = path.join(process.env.RUNNER_TEMP!, 'colab-acceptance-results');
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, `large-page-${name}-trace.json`),
        JSON.stringify({ events, truncated, incomplete }),
      );
      await client.detach().catch(() => {});
    }
  };
}
const text = (n: number) => {
  let out = '';
  for (let i = 0; out.length < n; i++)
    out += `<p id="p${i}">Line ${i}: ${'lorem ipsum dolor sit amet '.repeat(3)}</p>\n`;
  return out.slice(0, n);
};
/** Whole paragraphs, at least `n` bytes: a page whose last paragraph is cut is never left open
 * before the next node, which would make every update parse the page whole (#5891). */
const paragraphs = (n: number) => {
  let out = '';
  for (let i = 0; out.length < n; i++)
    out += `<p id="p${i}">Line ${i}: ${'lorem ipsum dolor sit amet '.repeat(3)}</p>\n`;
  return out;
};
test.afterEach(disposeActiveWorlds);
test('260 CLI changes with a browser edit in the middle read back exact in the CLI and the browser', async () => {
  test.setTimeout(600_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const a = await pairBrowser(world, 'compact-author');
    const colab = world.binaries.colab;
    const read = (id: string) =>
      JSON.parse(run(world, colab, ['page', 'read', id, '--json'])) as { source: string };
    const created = createPage(world, 'Many changes', '<p>start</p>');
    const page = await openPage(door, a, created);

    let source = '<p>start</p>';
    const append = (i: number) => {
      source += `<i>${String(i).padStart(4, '0')}</i>`;
      run(world, colab, patchArgs(world, created.pageId, ['--file', '-', '--json']), source);
    };
    for (let i = 0; i < 100; i++) append(i);
    // The browser edits in the middle of the run, on top of the CLI's changes.
    await page.reload();
    await (await pageAction(page, 'Source')).click();
    const box = page.getByRole('textbox', { name: 'Page source', exact: true });
    expect((await box.inputValue()) === source).toBe(true);
    source += '<p>from the browser</p>';
    await box.evaluate((el, value) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, source);
    await page.getByRole('button', { name: 'Save source', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => read(created.pageId).source === source).toBe(true);
    // More than the old 200-change limit, with the CLI's own changes after the browser's.
    for (let i = 100; i < 260; i++) append(i);
    expect(read(created.pageId).source === source).toBe(true);

    await page.reload();
    await (await pageAction(page, 'Source')).click();
    expect(
      (await page.getByRole('textbox', { name: 'Page source', exact: true }).inputValue()) ===
        source,
    ).toBe(true);
  });
});

test('a 2 MiB page keeps taking changes and reads back exact', async () => {
  // 300 patches of a 2 MiB page take 8 to 11 minutes on CI debug binaries (#5511); #5548 cuts more.
  test.setTimeout(900_000);
  await withWorld(async (world) => {
    const colab = world.binaries.colab;
    let source = text(2 * MIB - 16 * 1024);
    const created = createPage(world, 'Big and busy', source);
    const readSource = () =>
      (
        JSON.parse(run(world, colab, ['page', 'read', created.pageId, '--json'])) as {
          source: string;
        }
      ).source;
    expect(readSource() === source).toBe(true);
    // Each patch is anchored on the source this case holds: every patch's range fence proves the
    // page still has it, so only the first and last reads go through the CLI.
    for (let i = 0; i < 300; i++) {
      const held = source;
      source = source.slice(0, -4) + `<i>${i}</i>` + source.slice(-4);
      run(world, colab, patchArgs(world, created.pageId, ['--file', '-', '--json'], held), source);
    }
    expect(readSource() === source).toBe(true);
  });
});

// #5872: a history-heavy page stays responsive: a short source that agents rewrote many times, so
// its state carries far more history than text (several checkpoints and a tail of updates, the
// shape of the page in Ben's trace). While it sits open and takes live writes, the main thread's
// long tasks are counted; their total is recorded, and only the count is asserted.
test('a history-heavy page keeps its main thread free while it takes writes', async () => {
  test.setTimeout(900_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'history-owner');
    const colab = world.binaries.colab;
    const body = (n: number) =>
      `${text(28 * 1024 - 32).replaceAll('Line', `Rev ${n}`)}<p id="n">${n}</p>`;
    let source = body(0);
    const created = createPage(world, 'History heavy', source);
    const change = (i: number) => {
      const held = source;
      source = body(i);
      run(world, colab, patchArgs(world, created.pageId, ['--file', '-', '--json'], held), source);
    };
    for (let i = 1; i <= 120; i++) change(i);
    const page = await openPage(door, browser, created);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#n')).toHaveText('120', { timeout: 120_000 });
    await page.evaluate(() => {
      const long: number[] = [];
      Object.defineProperty(window, 'longTasks', { value: long });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) long.push(entry.duration);
      }).observe({ type: 'longtask' });
    });
    const started = Date.now();
    for (let i = 121; i <= 150; i++) {
      change(i);
      await expect(frame.locator('#n')).toHaveText(String(i), { timeout: 60_000 });
    }
    // The rest of a 30 s window open and idle.
    await page.waitForTimeout(Math.max(0, 30_000 - (Date.now() - started)));
    const long = await page.evaluate(
      () => (window as unknown as { longTasks: number[] }).longTasks,
    );
    test.info().annotations.push({
      type: 'colab-history-busy',
      description: JSON.stringify({
        longTasks: long.length,
        busyMs: Math.round(long.reduce((sum, value) => sum + value, 0)),
        windowMs: Date.now() - started,
      }),
    });
    expect(long.length).toBeLessThanOrEqual(2);
  });
});

// #5891: on a page near the 2 MiB source limit, a live write changes a few bytes; the frame
// applies it without long main-thread tasks. Only the count is asserted; the total is recorded.
// A paragraph left open near the top changes only how an edit beside it is parsed: an edit near the
// bottom still parses only what changed.
for (const [kind, top] of [
  ['', ''],
  [' with a paragraph left open at the top', '<p id="top">Left open\n'],
] as const)
  test(`a 2 MiB page${kind} keeps its main thread free while it takes live writes`, async () => {
    test.setTimeout(900_000);
    await withWorld(async (world) => {
      const door = await startDoor(world, await freePort());
      const browser = await pairBrowser(world, 'large-owner');
      const colab = world.binaries.colab;
      const body = top + paragraphs(2 * MIB - 16 * 1024);
      let source = `${body}<p id="n">0</p>`;
      const createStarted = Date.now();
      const created = createPage(world, 'Large and live', source);
      const createMs = Date.now() - createStarted;
      const openStarted = Date.now();
      const page = await openPage(door, browser, created);
      const openMs = Date.now() - openStarted;
      const frame = page.frameLocator('iframe');
      const firstPaintStarted = Date.now();
      await expect(frame.locator('#n')).toHaveText('0', { timeout: 120_000 });
      const firstPaintMs = Date.now() - firstPaintStarted;
      // The frame parses its bound page once, when idle after drawing it; writes come after that.
      const prepareStarted = Date.now();
      await expect(frame.locator('html[data-colab-prepared]')).toHaveCount(1, { timeout: 60_000 });
      const prepareMs = Date.now() - prepareStarted;
      const finishTrace = await traceLargeWrites(page, kind ? 'open' : 'regular');
      const clock = await page.evaluate(() => {
        const long: { duration: number; start: number; owner: string }[] = [];
        Object.defineProperty(window, 'longTasks', { value: long });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const task = entry as PerformanceEntry & {
              attribution?: readonly { containerType?: string }[];
            };
            const kind = task.attribution?.[0]?.containerType;
            long.push({
              duration: entry.duration,
              start: entry.startTime,
              owner: kind === 'iframe' ? 'iframe' : kind === 'window' ? 'window' : 'other',
            });
          }
        }).observe({ type: 'longtask' });
        console.timeStamp('colab-large-start');
        return { origin: performance.timeOrigin, mark: performance.now() };
      });
      const started = Date.now();
      const writes: { patchMs: number; readyMs: number; begin: number; end: number }[] = [];
      try {
        for (let i = 1; i <= 10; i++) {
          const held = source;
          source = `${body}<p id="n">${i}</p>`;
          const begin = Date.now() - started;
          const patchStarted = Date.now();
          run(
            world,
            colab,
            patchArgs(world, created.pageId, ['--file', '-', '--json'], held),
            source,
          );
          const patchMs = Date.now() - patchStarted;
          const readyStarted = Date.now();
          await expect(frame.locator('#n')).toHaveText(String(i), { timeout: 60_000 });
          const readyMs = Date.now() - readyStarted;
          const write = { patchMs, readyMs, begin, end: Date.now() - started };
          writes.push(write);
        }
      } finally {
        await finishTrace();
      }
      await page.waitForTimeout(Math.max(0, 30_000 - (Date.now() - started)));
      const long = await page.evaluate(
        () =>
          (window as unknown as { longTasks: { duration: number; start: number; owner: string }[] })
            .longTasks,
      );
      const busy = JSON.stringify({
        longTasks: long.map((task) => ({
          duration: Math.round(task.duration),
          start: Math.round(task.start),
          owner: task.owner,
        })),
        busyMs: Math.round(long.reduce((sum, value) => sum + value.duration, 0)),
        windowMs: Date.now() - started,
        timeOrigin: clock.origin,
        traceMarkMs: clock.mark,
        startedEpochMs: started,
        setup: { createMs, openMs, firstPaintMs, prepareMs },
        writes,
      });
      test.info().annotations.push({ type: 'colab-large-busy', description: busy });
      // The run log keeps the durations, so a slower runner's failure says how far it was.
      console.log(`colab-large-busy ${busy}`);
      expect(long.length).toBeLessThanOrEqual(2);
    });
  });
