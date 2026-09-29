import { parseArgs } from 'node:util';

import type { InitialiseFleet } from '../../core/registry/initialise-fleet.js';
import type { CommandIo, ExitCode } from './io.js';

const USAGE = 'Usage: npm run fleet:init -w @aeolus-fleet/server -- --name "<fleet name>"';

/**
 * `fleet:init --name <name>`: asks for the operator's email and password, then
 * creates the fleet, its operator ship argo and the operator account the
 * console signs in with. Refuses when a fleet already exists.
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

  const email = await io.ask('Operator email: ');
  const password = await io.ask('Operator password: ', { isHidden: true });
  const repeated = await io.ask('Repeat the password: ', { isHidden: true });
  if (email === undefined || password === undefined || repeated === undefined) {
    io.err('fleet:init needs the operator email and the password twice. Nothing was created.');
    return 2;
  }
  if (password !== repeated) {
    io.err('The two passwords differ. Nothing was created.');
    return 1;
  }

  const initialised = await deps.initialiseFleet({ name, email, password });
  if (!initialised.isOk) {
    io.err(initialised.error.message);
    return 1;
  }

  const { fleetId, operatorShipId, operatorId, secret } = initialised.value;
  io.out(
    [
      `Fleet initialised: ${fleetId}`,
      `Operator ship argo: ${operatorShipId}`,
      `Operator account: ${operatorId}`,
      '',
      "argo's secret, shown this once. Store it safely now:",
      '',
      `  ${secret}`,
      '',
      'Sign in to the console with it. If it is ever lost, run argo:replace-secret on the server.',
    ].join('\n'),
  );
  return 0;
}
