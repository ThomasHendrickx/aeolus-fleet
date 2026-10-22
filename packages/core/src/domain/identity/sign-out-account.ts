import type { AccountId, IdGenerator } from '@aeolus-fleet/common';

import { endLease, type LeaseTx } from '../registry/public.js';
import type { Clock } from '../shared/clock.js';
import type { Actor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ConsoleSessionRepository } from './ports.js';

const INSTALLATION: Actor = { kind: 'installation' };

export interface SignOutAccountTx extends LeaseTx {
  consoleSessions: ConsoleSessionRepository;
}

export type SignOutAccount = (input: { accountId: AccountId }) => Promise<void>;

/**
 * Use case: pagasae, as the installation, says an account signed out in the
 * account app, and sign-out anywhere is sign-out everywhere. Every console
 * sign-in as argo the account opened ends, in every fleet, and with it the
 * lease on argo it held, the installation the actor. argo's own sign-in and
 * one another account holds stay. Its tokens stay good: it is no cut-off.
 * Safe to repeat.
 */
export function createSignOutAccount(deps: { uow: UnitOfWork<SignOutAccountTx>; clock: Clock; ids: IdGenerator }): SignOutAccount {
  return async ({ accountId }) => {
    const now = deps.clock.now();
    await deps.uow.run(async (tx) => {
      for (const session of await tx.consoleSessions.endAllOfAccount(accountId, { at: now, reason: 'signedOut' })) {
        if (session.leaseId !== null) {
          await endLease({ tx, ids: deps.ids }, { fleetId: session.fleetId, leaseId: session.leaseId, actor: INSTALLATION, at: now, reason: 'signedOut' });
        }
      }
      return ok(undefined);
    });
  };
}
