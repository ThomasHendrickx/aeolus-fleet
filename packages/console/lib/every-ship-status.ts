import type { ShipStatus } from '@aeolus-fleet/common';

/** Every ship status: a read of every ship asks it, since fleet.list answers active ships only unless the status filter asks for retired ones. */
export const EVERY_SHIP_STATUS: ShipStatus[] = ['awaitingCrew', 'crewed', 'retired'];
