import type { FleetId } from '@aeolus-fleet/common';

import { networkOf } from './declaration.js';
import type { FleetNetwork, FleetNetworks } from './ports.js';

export type ReadNetwork = (fleetId: FleetId) => Promise<FleetNetwork>;

/** Use case: a fleet's network as argo edits it: what argo saved last, or no rules and the default declaration. */
export function createReadNetwork(deps: { networks: FleetNetworks }): ReadNetwork {
  return async (fleetId) => networkOf(await deps.networks.find(fleetId));
}
