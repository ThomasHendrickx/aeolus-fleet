import { parseArgs } from 'node:util';

import type { IssueSignInLink } from '../../domain/identity/issue-sign-in-link.js';
import type { ListFleets } from '../../domain/registry/list-fleets.js';
import type { CommandIo, ExitCode } from './io.js';
import { SIGN_IN_LINK_NOTE, signInLinkOf } from './sign-in-link.js';

const USAGE = 'Usage: aeolus-core sign-in';

/**
 * `sign-in`: prints a fresh one-use console link that signs in as argo
 * (accounts design, A1), for another browser or once the first expired.
 * Asks nothing. v1 hosts one fleet, so it acts on that one.
 */
export async function signIn(
  args: string[],
  deps: { listFleets: ListFleets; issueSignInLink: IssueSignInLink; consoleOrigin: string; io: CommandIo },
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
    io.err(`This installation hosts ${String(fleets.length)} fleets; sign-in handles one.`);
    return 1;
  }

  const link = await deps.issueSignInLink({ fleetId: fleet.id });
  if (!link.isOk) {
    io.err(link.error.message);
    return 1;
  }
  io.out(`Open ${signInLinkOf(deps.consoleOrigin, link.value.ticket)} to sign in to the console as argo.\n${SIGN_IN_LINK_NOTE}`);
  return 0;
}
