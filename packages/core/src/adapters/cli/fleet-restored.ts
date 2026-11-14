import { parseArgs } from 'node:util';

import type { EndLeasesAfterRestore } from '../../domain/registry/end-leases-after-restore.js';
import type { ListFleets } from '../../domain/registry/list-fleets.js';
import type { CommandIo, ExitCode } from './io.js';

const USAGE = 'Usage: aeolus-core fleet:restored';

/**
 * `fleet:restored`: run once after `pg_restore` and before `aeolus-core
 * start` (docs/design/self-hosting-operations.md, section 5). In every fleet
 * of the installation, each in its own unit of work, it ends every open lease
 * but argo's with the reason `restored`. Refused while a core process is
 * connected to the database, whose crews it would cut off mid-work.
 */
export async function fleetRestored(
  args: string[],
  deps: {
    isCoreConnected: () => Promise<boolean>;
    listFleets: ListFleets;
    endLeasesAfterRestore: EndLeasesAfterRestore;
    io: CommandIo;
  },
): Promise<ExitCode> {
  const { io } = deps;

  try {
    parseArgs({ args, options: {}, strict: true });
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (await deps.isCoreConnected()) {
    io.err('A core process is connected to this database: stop every core process first. Nothing changed.');
    return 1;
  }

  for (const fleet of await deps.listFleets()) {
    const ended = await deps.endLeasesAfterRestore({ fleetId: fleet.id });
    if (!ended.isOk) {
      io.err(ended.error.message);
      return 1;
    }
    const { endedLeases } = ended.value;
    io.out(`Ended ${String(endedLeases)} ${endedLeases === 1 ? 'lease' : 'leases'} in fleet ${fleet.name}, reason restored.`);
  }
  return 0;
}
