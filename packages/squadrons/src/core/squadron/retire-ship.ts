import type { ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal } from '../management/ports.js';
import { err, ok, type Result } from '../shared/result.js';

/**
 * Retires a ship as the management ship. A ship retired already is fine: a
 * step repeated after a crash, or a ship the operator retired in the console.
 */
export async function retireShip(door: FleetDoor, ship: { crewToken: string; shipId: ShipId }): Promise<Result<undefined, FleetRefusal>> {
  const retired = await door.retire(ship.crewToken, { shipId: ship.shipId });
  if (retired.isOk) {
    return retired;
  }
  const read = await door.getShip(ship.crewToken, { shipId: ship.shipId });
  return read.isOk && read.value.status === 'retired' ? ok(undefined) : err(retired.error);
}
