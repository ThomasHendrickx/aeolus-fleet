import { parseArgs } from 'node:util';

import type { ResetOperatorPassword } from '../../core/identity/reset-operator-password.js';
import type { ListFleets } from '../../core/registry/list-fleets.js';
import { askNewPassword, nulRefusal, type CommandIo, type ExitCode } from './io.js';

const USAGE = 'Usage: npm run operator:reset-password -w @aeolus-fleet/server';

/**
 * `operator:reset-password`: asks for a new operator password, sets it, and
 * ends every console session. v1 hosts one fleet, so it acts on that one.
 */
export async function operatorResetPassword(
  args: string[],
  deps: { listFleets: ListFleets; resetOperatorPassword: ResetOperatorPassword; io: CommandIo },
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
    io.err(`This installation hosts ${String(fleets.length)} fleets; operator:reset-password handles one.`);
    return 1;
  }

  const password = await askNewPassword(io, 'New operator password: ');
  if (password.kind === 'ended') {
    io.err('operator:reset-password needs the new password twice. Nothing was changed.');
    return 2;
  }
  if (password.kind === 'differ') {
    io.err('The two passwords differ. Nothing was changed.');
    return 1;
  }
  const refusal = nulRefusal([{ name: 'operator password', text: password.password }], 'Nothing was changed.');
  if (refusal !== undefined) {
    io.err(refusal);
    return 1;
  }

  const reset = await deps.resetOperatorPassword({ fleetId: fleet.id, password: password.password });
  if (!reset.isOk) {
    io.err(reset.error.message);
    return 1;
  }

  io.out(
    `The operator password for fleet ${fleet.id} is reset. Every console session has ended: sign in with the new password.`,
  );
  return 0;
}
