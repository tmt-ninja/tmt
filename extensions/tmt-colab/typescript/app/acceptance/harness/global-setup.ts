import { AcceptanceWorld } from './world.js';
import { sweepWorlds } from './world-registry.js';

/** Stop worlds an earlier run in this checkout left running when its process was killed (#5892). */
export default async function globalSetup(): Promise<void> {
  const leaked = await sweepWorlds(AcceptanceWorld.stopServer);
  if (leaked.length)
    console.warn(
      `Stopped ${leaked.length} acceptance world(s) an earlier run left running:\n${leaked.join('\n')}`,
    );
}
