import type { AccountId, IdGenerator } from '@aeolus-fleet/common';

import { endLease, type LeaseTx } from '../registry/public.js';
import type { Clock } from '../shared/clock.js';
import type { Actor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { ACCOUNT_TOKEN_CLOCK_ALLOWANCE_MS, ACCOUNT_TOKEN_LIFE_MS } from './authenticate-account.js';
import type { AccountCutOffRepository, ConsoleSessionRepository } from './ports.js';

/**
 * How long a cut-off is kept: the longest a token issued before it is
 * accepted, its life and the allowance on it, and the allowance on its end.
 */
const CUT_OFF_KEPT_MS = ACCOUNT_TOKEN_LIFE_MS + 2 * ACCOUNT_TOKEN_CLOCK_ALLOWANCE_MS;

const INSTALLATION: Actor = { kind: 'installation' };

export interface CutOffAccountTx extends LeaseTx {
  consoleSessions: ConsoleSessionRepository;
}

export type CutOffAccount = (input: { accountId: AccountId }) => Promise<void>;

/**
 * Use case: pagasae, as the installation, cuts off a disabled account
 * (decisions 0055, 0058). Every token of it issued before now is refused in
 * every fleet of the installation, until the longest of them has ended; then
 * core forgets the account. Recording one forgets those that ended. The
 * cut-off itself writes no event: it belongs to the installation, not to a
 * fleet, and names no ship.
 *
 * Every console sign-in as argo by the account ends too, in every fleet, and
 * with it the lease on argo it held, the installation the actor. pagasae calls
 * again when a call fails: both halves are safe to repeat.
 */
export function createCutOffAccount(deps: {
  cutOffs: AccountCutOffRepository;
  uow: UnitOfWork<CutOffAccountTx>;
  clock: Clock;
  ids: IdGenerator;
}): CutOffAccount {
  return async ({ accountId }) => {
    const now = deps.clock.now();
    await deps.cutOffs.forget(now);
    await deps.cutOffs.record({ accountId, cutOffAt: now, forgetAt: new Date(now.getTime() + CUT_OFF_KEPT_MS) });

    await deps.uow.run(async (tx) => {
      for (const session of await tx.consoleSessions.endAllOfAccount(accountId, { at: now, reason: 'accountCutOff' })) {
        if (session.leaseId !== null) {
          await endLease({ tx, ids: deps.ids }, { fleetId: session.fleetId, leaseId: session.leaseId, actor: INSTALLATION, at: now, reason: 'accountCutOff' });
        }
      }
      return ok(undefined);
    });
  };
}
