import { parseArgs } from 'node:util';

import type { IssueSignInLink } from '../../domain/identity/issue-sign-in-link.js';
import type { InitialiseFleet } from '../../domain/registry/initialise-fleet.js';
import type { ListFleets } from '../../domain/registry/list-fleets.js';
import { nulRefusal, type CommandIo, type ExitCode } from './io.js';
import { SIGN_IN_LINK_NOTE, signInLinkOf } from './sign-in-link.js';

const NOTHING_CREATED = 'Nothing was created.';

const USAGE = 'Usage: aeolus-core fleet:init --name "<fleet name>"';

/**
 * `fleet:init --name <name>`: creates the fleet, its operator ship argo and
 * argo's own sign-in, asking nothing, and prints a one-use console link that
 * signs in as argo (accounts design, A1). An email and password come later,
 * from Settings. Refuses when a fleet already exists; the use case checks
 * again under its lock, for two runs at once.
 */
export async function fleetInit(
  args: string[],
  deps: { initialiseFleet: InitialiseFleet; issueSignInLink: IssueSignInLink; listFleets: ListFleets; consoleOrigin: string; io: CommandIo },
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

  const initialised = await deps.initialiseFleet({ name });
  if (!initialised.isOk) {
    io.err(initialised.error.message);
    return 1;
  }

  const { fleetId, operatorShipId, operatorId } = initialised.value;
  const created = [`Fleet initialised: ${fleetId}`, `Operator ship argo: ${operatorShipId}`, `Operator account: ${operatorId}`];
  const link = await deps.issueSignInLink({ fleetId });
  if (!link.isOk) {
    io.out(created.join('\n'));
    io.err(`No sign-in link was issued: ${link.error.message}. Run npx aeolus-core sign-in for one.`);
    return 1;
  }
  io.out(
    [
      ...created,
      '',
      `Open ${signInLinkOf(deps.consoleOrigin, link.value.ticket)} to sign in to the console as argo.`,
      SIGN_IN_LINK_NOTE,
      'To sign in with an email and password instead, set them in Settings once you are in.',
    ].join('\n'),
  );
  return 0;
}
