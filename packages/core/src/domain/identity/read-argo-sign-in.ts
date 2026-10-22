import type { AccountId } from '@aeolus-fleet/common';

import type { AccountCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ConsoleSessionRepository } from './ports.js';

export interface ReadArgoSignInTx {
  consoleSessions: Pick<ConsoleSessionRepository, 'findOperatorSignIn'>;
}

/** Whether someone is signed in as argo now: an account, by its id, or argo's own sign-in, which names none (decision 0054). */
export type ArgoSignIn = { isSignedIn: false } | { isSignedIn: true; accountId: AccountId | null };

export type ReadArgoSignIn = (caller: AccountCaller) => Promise<Result<ArgoSignIn, DomainError<'NOT_ALLOWED_AS_ARGO'>>>;

/**
 * Use case: who holds argo's sign-in in the account's fleet, so the console
 * warns before the account signs in as argo and ends it (accounts design, F4,
 * A7). A sign-in that ended or went unused past its limit holds nothing.
 * Only an account pagasae allows as argo of the fleet may know: any other
 * learns nothing, not even whether someone holds it. Reaching argo is
 * untouched.
 */
export function createReadArgoSignIn(deps: { uow: UnitOfWork<ReadArgoSignInTx>; clock: Clock }): ReadArgoSignIn {
  return (caller) => {
    if (caller.isArgoAllowed !== true) {
      return Promise.resolve(refuse('NOT_ALLOWED_AS_ARGO', "Only an account allowed as argo reads who holds argo's sign-in"));
    }
    return deps.uow.run(async (tx): Promise<Result<ArgoSignIn, never>> => {
      const session = await tx.consoleSessions.findOperatorSignIn(caller.fleetId, deps.clock.now());
      return ok(session ? { isSignedIn: true, accountId: session.accountId } : { isSignedIn: false });
    });
  };
}
