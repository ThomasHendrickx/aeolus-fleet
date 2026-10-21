import type { IdGenerator, OperatorId } from '@aeolus-fleet/common';

import { actorOf, type ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { PasswordHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { operatorEmail, operatorPassword } from './operator-account.js';
import type { OperatorAccountRepository } from './ports.js';

export interface SetOperatorLoginTx {
  operatorAccounts: OperatorAccountRepository;
  events: EventLog;
}

export type SetOperatorLoginRefusal = DomainError<'INVALID_EMAIL' | 'INVALID_PASSWORD' | 'OPERATOR_EMAIL_TAKEN' | 'NO_OWN_SIGN_IN' | 'NOT_THE_OPERATOR_SHIP'>;

export type SetOperatorLogin = (
  caller: ShipCaller,
  input: { email: string; password: string },
) => Promise<Result<{ operatorId: OperatorId }, SetOperatorLoginRefusal>>;

/**
 * Use case: argo, signed in to the console, sets the email and password of
 * its own sign-in (decision 0012, accounts design A1). Only where core trusts
 * no pagasae: a hosted fleet has no own sign-in for argo (decision 0054). The
 * email is the user name, unique across the installation, as at fleet:init.
 * The old email and password stop working; the console session that set
 * them stays, since it is the one argo sign-in.
 */
export function createSetOperatorLogin(deps: {
  uow: UnitOfWork<SetOperatorLoginTx>;
  clock: Clock;
  ids: IdGenerator;
  passwords: PasswordHasher;
  /** Whether core trusts no pagasae: argo's own sign-in is then the way in. */
  isSelfHosted: boolean;
}): SetOperatorLogin {
  return async (caller, input) => {
    if (!deps.isSelfHosted) {
      return refuse('NO_OWN_SIGN_IN', 'A hosted fleet has no own sign-in for argo: sign in with your account');
    }
    if (caller.consoleSessionId === undefined || caller.kind !== 'operator') {
      return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo, signed in to the console, sets its email and password');
    }
    const email = operatorEmail(input.email);
    if (!email.isOk) {
      return email;
    }
    const password = operatorPassword(input.password);
    if (!password.isOk) {
      return password;
    }
    // Hashed before the transaction: Argon2 takes its time on purpose.
    const passwordHash = await deps.passwords.hash(password.value);

    return deps.uow.run(async (tx): ReturnType<SetOperatorLogin> => {
      const { fleetId } = caller;
      await tx.operatorAccounts.lockEmail(email.value);
      const account = await tx.operatorAccounts.findForFleetForUpdate(fleetId);
      if (!account) {
        return refuse('NOT_THE_OPERATOR_SHIP', 'Only argo, signed in to the console, sets its email and password');
      }
      const holder = await tx.operatorAccounts.findByEmailForUpdate(email.value);
      if (holder !== undefined && holder.id !== account.id) {
        return refuse('OPERATOR_EMAIL_TAKEN', `An operator already signs in with ${email.value}`);
      }
      await tx.operatorAccounts.changeLogin({ fleetId, operatorId: account.id, email: email.value, passwordHash });
      await recordEvent({ events: tx.events, ids: deps.ids }, {
        fleetId,
        type: 'OperatorLoginSet',
        occurredAt: deps.clock.now(),
        actor: actorOf(caller),
        shipId: caller.shipId,
        details: { operatorId: account.id },
      });
      return ok({ operatorId: account.id });
    });
  };
}
