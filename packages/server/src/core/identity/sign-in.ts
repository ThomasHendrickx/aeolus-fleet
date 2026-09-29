import type { ConsoleSessionId, IdGenerator } from '@aeolus-fleet/common';

import { findOperatorShip, takeOverOperatorLease, type LeaseTx, type ShipTx } from '../registry/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { PasswordHasher, RandomTokens, SecretHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { CONSOLE_LOCATION, consoleSessionExpiry } from './console-session.js';
import { normaliseEmail } from './operator-account.js';
import type { ConsoleSessionRepository, OperatorAccountLookup, OperatorAccountRepository } from './ports.js';

export interface SignInTx extends LeaseTx, ShipTx {
  operatorAccounts: OperatorAccountRepository;
  consoleSessions: ConsoleSessionRepository;
}

export interface SignedIn {
  /** The session token for the cookie, in plain text only here. */
  token: string;
  consoleSessionId: ConsoleSessionId;
  expiresAt: Date;
  caller: Caller;
}

/** Only a wrong email or password in practice: the account's fleet always has its argo. */
export type SignInRefusal = DomainError<'WRONG_EMAIL_OR_PASSWORD' | 'FLEET_NOT_FOUND' | 'NOT_THE_OPERATOR_SHIP'>;

export type SignIn = (input: { email: string; password: string }) => Promise<Result<SignedIn, SignInRefusal>>;

const WRONG_EMAIL_OR_PASSWORD = 'Wrong email or password';

/**
 * Use case: the operator signs in to the console with email and password, and
 * the session crews `argo` (ADR 0012). Signing in ends the previous console
 * session and takes argo's lease over, so its deliveries in flight return to
 * pending.
 *
 * A wrong email and a wrong password are one refusal, and both check a
 * password, so neither the answer nor its timing says whether the email
 * exists. The password is checked before the unit of work: Argon2 takes its
 * time on purpose, and no account row or connection waits on it. The unit of
 * work then locks the account and finds the same password hash, or refuses:
 * a reset in between makes the checked password wrong, and a reset after
 * waits for the lock, then ends the new session.
 */
export function createSignIn(deps: {
  uow: UnitOfWork<SignInTx>;
  accounts: OperatorAccountLookup;
  clock: Clock;
  ids: IdGenerator;
  hasher: SecretHasher;
  random: RandomTokens;
  passwords: PasswordHasher;
}): SignIn {
  return async (input) => {
    const email = normaliseEmail(input.email);
    const account = await deps.accounts.byEmail(email);
    const isPasswordRight = await deps.passwords.verify(input.password, account?.passwordHash);
    if (!account || !isPasswordRight) {
      return refuse('WRONG_EMAIL_OR_PASSWORD', WRONG_EMAIL_OR_PASSWORD);
    }

    return deps.uow.run(async (tx): Promise<Result<SignedIn, SignInRefusal>> => {
      const locked = await tx.operatorAccounts.findByEmailForUpdate(email);
      if (locked?.id !== account.id || locked.passwordHash !== account.passwordHash) {
        return refuse('WRONG_EMAIL_OR_PASSWORD', WRONG_EMAIL_OR_PASSWORD);
      }
      const found = await findOperatorShip(tx, account.fleetId);
      if (!found.isOk) {
        return found;
      }
      const argo = found.value;

      const at = deps.clock.now();
      const actor = shipActor(argo.id);

      await tx.consoleSessions.endAll(argo.fleetId, at);
      const takenOver = await takeOverOperatorLease({ tx, ids: deps.ids }, {
        fleetId: argo.fleetId,
        shipId: argo.id,
        kind: argo.kind,
        location: CONSOLE_LOCATION,
        actor,
        at,
      });
      if (!takenOver.isOk) {
        return takenOver;
      }

      const token = deps.random.next();
      const consoleSessionId = deps.ids('consoleSession');
      const expiresAt = consoleSessionExpiry(at);
      await tx.consoleSessions.create({
        id: consoleSessionId,
        fleetId: argo.fleetId,
        shipId: argo.id,
        leaseId: takenOver.value,
        tokenHash: deps.hasher.hash(token),
        createdAt: at,
        lastUsedAt: at,
        expiresAt,
        endedAt: null,
      });

      const caller: Caller = {
        shipId: argo.id,
        fleetId: argo.fleetId,
        kind: argo.kind,
        scopes: argo.scopes,
        consoleSessionId,
      };
      return ok({ token, consoleSessionId, expiresAt, caller });
    });
  };
}
