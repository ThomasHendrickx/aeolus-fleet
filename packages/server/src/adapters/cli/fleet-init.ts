import { parseArgs } from 'node:util';

import type { InitialiseFleet } from '../../core/registry/initialise-fleet.js';
import { DomainError } from '../../core/shared/errors.js';
import type { CommandIo, ExitCode } from './io.js';

const USAGE = 'Usage: npm run fleet:init -w @aeolus-fleet/server -- --name "<fleet name>"';

/**
 * `fleet:init --name <name>`: creates the fleet and its operator ship argo, and
 * prints argo's secret once. Refuses when a fleet already exists.
 */
export async function fleetInit(
  args: string[],
  deps: { initialiseFleet: InitialiseFleet; io: CommandIo },
): Promise<ExitCode> {
  const { io } = deps;

  let name: string | undefined;
  try {
    ({ name } = parseArgs({ args, options: { name: { type: 'string' } }, strict: true }).values);
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (name === undefined) {
    io.err(`fleet:init needs the fleet's name.\n${USAGE}`);
    return 2;
  }

  try {
    const { fleetId, operatorShipId, secret } = await deps.initialiseFleet({ name });
    io.out(
      [
        `Fleet initialised: ${fleetId}`,
        `Operator ship argo: ${operatorShipId}`,
        '',
        "argo's secret, shown this once. Store it safely now:",
        '',
        `  ${secret}`,
        '',
        'Sign in to the console with it. If it is ever lost, run argo:replace-secret on the server.',
      ].join('\n'),
    );
    return 0;
  } catch (error) {
    if (error instanceof DomainError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}
