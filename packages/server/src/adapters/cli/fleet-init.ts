import { parseArgs } from 'node:util';

import type { InitialiseFleet } from '../../core/registry/initialise-fleet.js';
import type { ListFleets } from '../../core/registry/list-fleets.js';
import { askNewPassword, nulRefusal, type CommandIo, type ExitCode } from './io.js';

const NOTHING_CREATED = 'Nothing was created.';

const USAGE = 'Usage: aeolus-server fleet:init --name "<fleet name>"';

/**
 * `fleet:init --name <name>`: asks for the operator's email and password, then
 * creates the fleet, its operator ship argo and the operator account the
 * console signs in with. Refuses when a fleet already exists, before asking
 * anything; the use case checks again under its lock, for two runs at once.
 */
export async function fleetInit(
  args: string[],
  deps: { initialiseFleet: InitialiseFleet; listFleets: ListFleets; io: CommandIo },
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
  const nameRefusal = nulRefusal([{ name: 'fleet name', text: name }], NOTHING_CREATED);
  if (nameRefusal !== undefined) {
    io.err(nameRefusal);
    return 1;
  }

  if ((await deps.listFleets()).length > 0) {
    io.err(`A fleet already exists: a fleet is initialised only once. ${NOTHING_CREATED}`);
    return 1;
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
  const answerRefusal = nulRefusal(
    [
      { name: 'operator email', text: email },
      { name: 'operator password', text: password.password },
    ],
    NOTHING_CREATED,
  );
  if (answerRefusal !== undefined) {
    io.err(answerRefusal);
    return 1;
  }

  const initialised = await deps.initialiseFleet({ name, email, password: password.password });
  if (!initialised.isOk) {
    io.err(initialised.error.message);
    return 1;
  }

  const { fleetId, operatorShipId, operatorId } = initialised.value;
  io.out(
    [
      `Fleet initialised: ${fleetId}`,
      `Operator ship argo: ${operatorShipId}`,
      `Operator account: ${operatorId}`,
      '',
      'Sign in to the console with the operator email and password: that crews argo.',
      'If the password is lost, run aeolus-server operator:reset-password on the server.',
    ].join('\n'),
  );
  return 0;
}
