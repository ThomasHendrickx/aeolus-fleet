import { SCOPES } from '@aeolus-fleet/common';

import type { FleetInitialised } from '../domain/registry/initialise-fleet.js';
import type { ShipCaller } from '../domain/shared/caller.js';

/** The fleet's public URL in tests: where ships reach it. */
export const FLEET_URL = 'https://fleet.example.com';

/** The operator's login in tests: what fleet init asks for, and sign-in takes. */
export const OPERATOR = { email: 'operator@example.com', password: 'correct horse battery staple' };

/** argo as the caller, holding every scope, as its secret or console session makes it. */
export function operatorCaller(fleet: FleetInitialised): ShipCaller {
  return { shipId: fleet.operatorShipId, fleetId: fleet.fleetId, kind: 'operator', scopes: [...SCOPES] };
}

/** The ship secret a use case issued; a commission that comes again issues none. */
export function secretOf(secret: string | null): string {
  if (secret === null) {
    throw new Error('No ship secret was issued');
  }
  return secret;
}
