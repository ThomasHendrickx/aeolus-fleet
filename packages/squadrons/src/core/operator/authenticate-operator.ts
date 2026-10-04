import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ConsoleSessions } from './ports.js';

export type AuthenticateOperator = (cookie: string | undefined) => Promise<Result<{ fleetId: FleetId }, DomainError<'NOT_THE_OPERATOR'>>>;

/**
 * Use case: whether a request comes from the operator. squadrons has no login
 * of its own: the web app's server forwards the console session cookie, and
 * the fleet says whose session it is (decision 0017). squadrons serves every
 * fleet at its FLEET_URL, each with its own connection, so any signed-in
 * operator there is let through as the operator of their own fleet.
 */
export function createAuthenticateOperator(deps: { sessions: ConsoleSessions }): AuthenticateOperator {
  const refusal = refuse('NOT_THE_OPERATOR', 'Sign in to the console of your fleet');
  return async (cookie) => {
    if (cookie === undefined) {
      return refusal;
    }
    const session = await deps.sessions.check(cookie);
    if (!session.isOk) {
      return refusal;
    }
    return ok({ fleetId: session.value.fleetId });
  };
}
