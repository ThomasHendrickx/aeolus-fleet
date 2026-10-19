import type { AccountTokenClaims } from '@aeolus-fleet/common';

import type { AccountCaller, ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { AccountCutOffLookup, AccountTokenSignatures, HostedFleets } from './ports.js';

/** How long pagasae's account token lives (decision 0058). */
export const ACCOUNT_TOKEN_LIFE_MS = 10 * 60_000;

/** The allowance between core's clock and pagasae's, on a token's end and issue (decision 0058). */
export const ACCOUNT_TOKEN_CLOCK_ALLOWANCE_MS = 30_000;

/**
 * Why an account token makes no caller: it ended, so whoever presented it
 * fetches a fresh one; or it is not to be trusted here at all, one refusal
 * that names no reason, so a forger learns nothing.
 */
export type AccountTokenRefusal = DomainError<'ACCOUNT_TOKEN_ENDED' | 'ACCOUNT_TOKEN_INVALID'>;

export type AuthenticateAccount = (token: string, presented: { through: ShipCaller | null }) => Promise<Result<AccountCaller, AccountTokenRefusal>>;

/**
 * Use case: turns an account token into the account as the caller (decision
 * 0058), checked on every call. pagasae's key signed it, naming pagasae (the
 * signatures port); it is for this fleet: the fleet of the ship that
 * presented it, or with none, a fleet this installation hosts; it has not
 * ended, with 30 seconds of allowance; it lives no longer than the 10
 * minutes pagasae gives one, so a misconfigured issuer cannot widen a
 * leaver's window, and was not issued later than now, so it cannot outlive
 * a cut-off; and its account was not cut off after it was issued. Core
 * stores nothing of the account.
 */
export function createAuthenticateAccount(deps: {
  signatures: AccountTokenSignatures;
  cutOffs: AccountCutOffLookup;
  fleets: HostedFleets;
  clock: Clock;
}): AuthenticateAccount {
  return async (token, { through }) => {
    const claims = await deps.signatures.verify(token);
    if (!claims || !(await isForThisFleet(deps.fleets, { claims, through }))) {
      return refuseInvalid();
    }
    const now = deps.clock.now().getTime();
    if (now > claims.endsAt.getTime() + ACCOUNT_TOKEN_CLOCK_ALLOWANCE_MS) {
      return refuse('ACCOUNT_TOKEN_ENDED', 'This account token has ended; present a fresh one');
    }
    const life = claims.endsAt.getTime() - claims.issuedAt.getTime();
    if (life > ACCOUNT_TOKEN_LIFE_MS + ACCOUNT_TOKEN_CLOCK_ALLOWANCE_MS || claims.issuedAt.getTime() > now + ACCOUNT_TOKEN_CLOCK_ALLOWANCE_MS) {
      return refuseInvalid();
    }
    const cutOffAt = await deps.cutOffs.cutOffAt(claims.accountId, deps.clock.now());
    if (cutOffAt !== undefined && claims.issuedAt < cutOffAt) {
      return refuseInvalid();
    }
    return ok({
      kind: 'account',
      accountId: claims.accountId,
      fleetId: claims.fleetId,
      scopes: claims.scopes,
      groupValues: claims.groupValues,
      personShipId: claims.personShipId,
      throughShipId: through?.shipId ?? null,
    });
  };
}

async function isForThisFleet(fleets: HostedFleets, token: { claims: AccountTokenClaims; through: ShipCaller | null }): Promise<boolean> {
  const { claims, through } = token;
  return through === null ? fleets.isHosted(claims.fleetId) : claims.fleetId === through.fleetId;
}

function refuseInvalid() {
  return refuse('ACCOUNT_TOKEN_INVALID', 'Present an account token pagasae signed for this fleet');
}
