import { expect, test } from '@playwright/test';
import { createPage, patchArgs, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';

const MIB = 1024 * 1024;
const text = (n: number) => {
  let out = '';
  for (let i = 0; out.length < n; i++)
    out += `<p id="p${i}">Line ${i}: ${'lorem ipsum dolor sit amet '.repeat(3)}</p>\n`;
  return out.slice(0, n);
};
test.afterEach(disposeActiveWorlds);

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
    const compactStarted = Date.now();
    const report = JSON.parse(run(world, colab, ['page', 'compact', created.pageId, '--json'])) as {
      compacted: boolean;
      mergedObjects: number;
    };
    const compact = JSON.stringify({
      durationMs: Date.now() - compactStarted,
      mergedObjects: report.mergedObjects,
    });
    test.info().annotations.push({ type: 'colab-compaction-time', description: compact });
    console.log(`colab-compaction-time ${compact}`);
    expect(report.compacted).toBe(true);
    expect(report.mergedObjects).toBeGreaterThan(0);
    expect(readSource() === source).toBe(true);
  });
});
