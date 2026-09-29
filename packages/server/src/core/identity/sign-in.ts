import type { ConsoleSessionId, IdGenerator } from '@aeolus-fleet/common';

import { takeOverOperatorLease, type LeaseTx } from '../registry/index.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { DomainError } from '../shared/errors.js';
import { shipActor } from '../shared/events.js';
import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { CONSOLE_LOCATION, consoleSessionExpiry } from './console-session.js';
import type { CredentialTx } from './credential.js';
import type { ConsoleSessionRepository } from './ports.js';

export interface SignInTx extends CredentialTx, LeaseTx {
  consoleSessions: ConsoleSessionRepository;
}

export interface SignedIn {
  /** The session token for the cookie, in plain text only here. */
  token: string;
  consoleSessionId: ConsoleSessionId;
  expiresAt: Date;
  caller: Caller;
}

export type SignIn = (input: { secret: string }) => Promise<SignedIn>;

/**
 * Use case: the console exchanges `argo`'s secret for a session (ADR 0012).
 * Signing in ends the previous console session and takes argo's lease over, so
 * its deliveries in flight return to pending. The secret stays valid.
 */
export function createSignIn(deps: {
  uow: UnitOfWork<SignInTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: SecretHasher;
  random: RandomTokens;
}): SignIn {
  return (input) =>
    deps.uow.run(async (tx) => {
      const found = await tx.credentials.findValidBySecretHashForUpdate(deps.hasher.hash(input.secret));
      if (!found) {
        throw new DomainError('INVALID_SECRET', 'This secret is not valid');
      }
      const { credential, ship } = found;
      if (ship.kind !== 'operator') {
        throw new DomainError('NOT_THE_OPERATOR_SHIP', 'Only argo, the operator ship, signs in to the console');
      }

      const at = deps.clock.now();
      const actor = shipActor(ship.shipId);

      await tx.consoleSessions.endAll(ship.fleetId, at);
      const leaseId = await takeOverOperatorLease(tx, deps.ids, {
        fleetId: ship.fleetId,
        shipId: ship.shipId,
        kind: ship.kind,
        location: CONSOLE_LOCATION,
        actor,
        at,
      });
      if (credential.claimedAt === null) {
        await tx.credentials.markClaimed(ship.fleetId, credential.id, at);
      }

      const token = deps.random.next();
      const consoleSessionId = deps.ids('consoleSession');
      const expiresAt = consoleSessionExpiry(at);
      await tx.consoleSessions.create({
        id: consoleSessionId,
        fleetId: ship.fleetId,
        shipId: ship.shipId,
        leaseId,
        tokenHash: deps.hasher.hash(token),
        createdAt: at,
        lastUsedAt: at,
        expiresAt,
        endedAt: null,
      });

      return { token, consoleSessionId, expiresAt, caller: { ...ship, consoleSessionId } };
    });
}
