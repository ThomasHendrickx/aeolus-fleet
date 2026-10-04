import type { FleetId } from '@aeolus-fleet/common';

import type { ManagementCrewStore } from '../management/ports.js';
import type { IsServed } from './served.js';

export type ReadFleet = (input: { fleetId: FleetId }) => Promise<{ isEnabled: boolean; isConnected: boolean }>;

/**
 * Use case: a fleet as the hosting service reads it: whether squadrons serves
 * it, and whether squadrons holds a crew token for it. Off and connected is a
 * fleet whose connection waits for it to be on again.
 */
export function createReadFleet(deps: { isServed: IsServed; management: ManagementCrewStore }): ReadFleet {
  return async ({ fleetId }) => ({ isEnabled: await deps.isServed(fleetId), isConnected: (await deps.management.find(fleetId)) !== undefined });
}
