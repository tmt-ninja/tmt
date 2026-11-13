// A CLI deadline met while the runner's disk, not the CLI, held the call is inconclusive
// (#6393, #6329): at the deadline the CLI was in uninterruptible sleep (D) with zero CPU
// ticks and no output. The native and e2e configs load this file as a setup file and give
// each test one retry; the hook below lets that retry run only when the failed attempt
// recorded such a stall. A second stall fails, and every other failure fails as before.
//
// `cli-process.ts` records the stall in a process-global slot rather than importing this
// file, since plain Node also loads it outside Vitest.
import { beforeEach } from 'vite-plus/test';

/** The slot `cli-process.ts` writes the stall evidence to; keep the key equal there. */
const STALL = Symbol.for('tmt.test.cliDiskStall');
const slot = globalThis as Record<symbol, unknown>;

beforeEach(({ task }) => {
  delete slot[STALL];
  // Vitest reads the condition when an attempt fails; the count comes from the config.
  const { retry } = task;
  if (typeof retry !== 'object') return;
  const condition = () => {
    const evidence = slot[STALL];
    if (typeof evidence !== 'string') return false;
    // One line per rerun, so a rise in runner stalls stays visible in CI logs.
    process.stderr.write(`CLI disk stall, inconclusive: ${task.name}: ${evidence}\n`);
    return true;
  };
  Object.assign(task, { retry: { ...retry, condition } });
});
