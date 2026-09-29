import { parseArgs } from 'node:util';

import type { ReplaceOperatorSecret } from '../../core/identity/replace-operator-secret.js';
import type { ListFleets } from '../../core/registry/list-fleets.js';
import type { CommandIo, ExitCode } from './io.js';

const USAGE = 'Usage: npm run argo:replace-secret -w @aeolus-fleet/server';

/**
 * `argo:replace-secret`: invalidates argo's secret, ends every console session,
 * and prints a new secret once. v1 hosts one fleet, so it acts on that one.
 */
export async function replaceArgoSecret(
  args: string[],
  deps: { listFleets: ListFleets; replaceOperatorSecret: ReplaceOperatorSecret; io: CommandIo },
): Promise<ExitCode> {
  const { io } = deps;

  try {
    parseArgs({ args, options: {}, strict: true });
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }

  const fleets = await deps.listFleets();
  const [fleet] = fleets;
  if (!fleet) {
    io.err('There is no fleet yet. Run fleet:init first.');
    return 1;
  }
  if (fleets.length > 1) {
    io.err(`This installation hosts ${String(fleets.length)} fleets; argo:replace-secret handles one.`);
    return 1;
  }

  const replaced = await deps.replaceOperatorSecret({ fleetId: fleet.id });
  if (!replaced.isOk) {
    io.err(replaced.error.message);
    return 1;
  }

  io.out(
    [
      `argo's secret for fleet ${fleet.id} is replaced. The old secret no longer works,`,
      'and every console session has ended.',
      '',
      "argo's new secret, shown this once. Store it safely now:",
      '',
      `  ${replaced.value.secret}`,
    ].join('\n'),
  );
  return 0;
}
