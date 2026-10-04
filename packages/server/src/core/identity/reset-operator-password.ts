import type { FleetId, IdGenerator, OperatorId } from '@aeolus-fleet/common';

import { endLease, findOperatorShip, type LeaseTx, type ShipTx } from '../registry/public.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, SYSTEM } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { PasswordHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { operatorPassword } from './operator-account.js';
import type { ConsoleSessionRepository, OperatorAccountRepository } from './ports.js';

export interface ResetOperatorPasswordTx extends LeaseTx, ShipTx {
  operatorAccounts: OperatorAccountRepository;
  consoleSessions: ConsoleSessionRepository;
}

export type ResetOperatorPassword = (input: {
  fleetId: FleetId;
  password: string;
}) => Promise<Result<{ operatorId: OperatorId }, DomainError<'INVALID_PASSWORD' | 'FLEET_NOT_FOUND' | 'OPERATOR_HAS_NO_PASSWORD'>>>;

/**
 * Use case: a forgotten operator password is reset from the server (ADR 0012).
 * The old password stops working, and every console session ends, and with it
 * the lease on argo it held. A server command: the system is the actor, and
 * the event concerns argo, so it shows on argo's timeline.
 *
 * Locks the account first, like sign-in, so a sign-in with the old password
 * either finishes before the reset, whose session then ends, or sees the new
 * password.
 */
export function createResetOperatorPassword(deps: {
  uow: UnitOfWork<ResetOperatorPasswordTx>;
  clock: Clock;
  ids: IdGenerator;
  passwords: PasswordHasher;
}): ResetOperatorPassword {
  return async ({ fleetId, password }) => {
    const valid = operatorPassword(password);
    if (!valid.isOk) {
      return valid;
    }
    // Hashed before the transaction: Argon2 takes its time on purpose.
    const passwordHash = await deps.passwords.hash(valid.value);

    return deps.uow.run(async (tx): ReturnType<ResetOperatorPassword> => {
      const account = await tx.operatorAccounts.findForFleetForUpdate(fleetId);
      if (!account) {
        return refuse('FLEET_NOT_FOUND', `Fleet ${fleetId} does not exist`);
      }
      if (account.passwordHash === null) {
        return refuse('OPERATOR_HAS_NO_PASSWORD', 'This operator has no password: they sign in only through the hosting service');
      }
      const argo = await findOperatorShip(tx, fleetId);
      if (!argo.isOk) {
        return argo;
      }
      const at = deps.clock.now();

      await tx.operatorAccounts.changePassword({ fleetId, operatorId: account.id, passwordHash });
      await recordEvent({ events: tx.events, ids: deps.ids }, {
        fleetId,
        type: 'OperatorPasswordReset',
        occurredAt: at,
        actor: SYSTEM,
        shipId: argo.value.id,
        details: { operatorId: account.id },
      });

      for (const session of await tx.consoleSessions.endAll({ fleetId, shipId: argo.value.id }, { at, reason: 'passwordReset' })) {
        if (session.leaseId !== null) {
          await endLease({ tx, ids: deps.ids }, { fleetId, leaseId: session.leaseId, actor: SYSTEM, at, reason: 'passwordReset' });
        }
      }
      return ok({ operatorId: account.id });
    });
  };
}
