import type { FleetId } from '@aeolus-fleet/common';

import type { ManagementCrewStore } from '../management/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ConsoleSessions } from './ports.js';

export type AuthenticateOperator = (cookie: string | undefined) => Promise<Result<{ fleetId: FleetId }, DomainError<'NOT_THE_OPERATOR'>>>;

/**
 * Use case: whether a request comes from the operator. squadrons has no login
 * of its own: the web app's server forwards the console session cookie, and
 * the fleet says whose session it is (decision 0017). Once squadrons was
 * connected, only the operator of that fleet, the fleet of its management
 * ship, is let through; before, any operator of the fleet at its FLEET_URL,
 * who may connect it.
 */
export function createAuthenticateOperator(deps: { sessions: ConsoleSessions; store: ManagementCrewStore }): AuthenticateOperator {
  const refusal = refuse('NOT_THE_OPERATOR', 'Sign in to the console of the fleet squadrons serves');
  return async (cookie) => {
    if (cookie === undefined) {
      return refusal;
    }
    const session = await deps.sessions.check(cookie);
    if (!session.isOk) {
      return refusal;
    }
    const binding = await deps.store.binding();
    return binding === undefined || binding.fleetId === session.value.fleetId ? ok({ fleetId: session.value.fleetId }) : refusal;
  };
}
