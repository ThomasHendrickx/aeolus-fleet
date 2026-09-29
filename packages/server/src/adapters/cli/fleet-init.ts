import { parseArgs } from 'node:util';

import type { InitialiseFleet } from '../../core/registry/initialise-fleet.js';
import { askNewPassword, type CommandIo, type ExitCode } from './io.js';

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
  const password = email === undefined ? { kind: 'ended' as const } : await askNewPassword(io, 'Operator password: ');
  if (email === undefined || password.kind === 'ended') {
    io.err('fleet:init needs the operator email and the password twice. Nothing was created.');
    return 2;
  }
  if (password.kind === 'differ') {
    io.err('The two passwords differ. Nothing was created.');
    return 1;
  }

  const initialised = await deps.initialiseFleet({ name, email, password: password.password });
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
      'Sign in to the console with the operator email and password. If the password is lost, run',
      'operator:reset-password on the server.',
    ].join('\n'),
  );
  return 0;
}
