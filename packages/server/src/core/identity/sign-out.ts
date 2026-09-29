import type { IdGenerator } from '@aeolus-fleet/common';

import { endLease, type LeaseTx } from '../registry/index.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { shipActor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ConsoleSessionRepository } from './ports.js';

export interface SignOutTx extends LeaseTx {
  consoleSessions: ConsoleSessionRepository;
}

export type SignOut = (caller: Caller) => Promise<void>;

/**
 * Use case: ends the caller's console session and releases the lease on `argo`
 * it holds. Signing out twice, or without a console session, changes nothing.
 */
export function createSignOut(deps: { uow: UnitOfWork<SignOutTx>; clock: Clock; ids: IdGenerator }): SignOut {
  return async (caller) => {
    const { consoleSessionId } = caller;
    if (consoleSessionId === undefined) {
      return;
    }

    await deps.uow.run(async (tx) => {
      const at = deps.clock.now();
      const session = await tx.consoleSessions.end(caller.fleetId, consoleSessionId, at);
      if (session) {
        await endLease(tx, deps.ids, {
          fleetId: session.fleetId,
          leaseId: session.leaseId,
          actor: shipActor(session.shipId),
          at,
          reason: 'signedOut',
        });
      }
      return ok(undefined);
    });
  };
}
