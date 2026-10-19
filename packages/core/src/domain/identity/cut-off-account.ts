import type { AccountId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { ACCOUNT_TOKEN_CLOCK_ALLOWANCE_MS, ACCOUNT_TOKEN_LIFE_MS } from './authenticate-account.js';
import type { AccountCutOffRepository } from './ports.js';

/**
 * How long a cut-off is kept: the longest a token issued before it is
 * accepted, its life and the allowance on it, and the allowance on its end.
 */
const CUT_OFF_KEPT_MS = ACCOUNT_TOKEN_LIFE_MS + 2 * ACCOUNT_TOKEN_CLOCK_ALLOWANCE_MS;

export type CutOffAccount = (input: { accountId: AccountId }) => Promise<void>;

/**
 * Use case: pagasae, as the installation, cuts off a disabled account's
 * tokens (decisions 0055, 0058): every token of it issued before now is
 * refused in every fleet of the installation, until the longest of them has
 * ended; then core forgets the account. Recording one forgets those that
 * ended. No event: the cut-off belongs to the installation, not to a fleet,
 * and names no ship.
 */
export function createCutOffAccount(deps: { cutOffs: AccountCutOffRepository; clock: Clock }): CutOffAccount {
  return async ({ accountId }) => {
    const now = deps.clock.now();
    await deps.cutOffs.forget(now);
    await deps.cutOffs.record({ accountId, cutOffAt: now, forgetAt: new Date(now.getTime() + CUT_OFF_KEPT_MS) });
  };
}
