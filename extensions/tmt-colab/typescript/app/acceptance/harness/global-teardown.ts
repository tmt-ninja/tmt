import { AcceptanceWorld } from './world.js';
import { sweepWorlds } from './world-registry.js';

/** No world of this run may outlive it: stop any left running and fail the run (#5892). */
export default async function globalTeardown(): Promise<void> {
  const leaked = await sweepWorlds(AcceptanceWorld.stopServer);
  if (leaked.length)
    throw new Error(
      `${leaked.length} acceptance world(s) were still running after the run:\n${leaked.join('\n')}`,
    );
}
