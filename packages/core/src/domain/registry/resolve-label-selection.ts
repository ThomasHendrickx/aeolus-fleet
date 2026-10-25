import type { FleetId, LabelValueId, ShipId } from '@aeolus-fleet/common';

import { refuse } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ShipRepository } from './ports.js';
import type { UnresolvableSelector } from './resolve-selector.js';
import { addressShip } from './ship.js';

/** The ports resolving a label selection reads, inside the caller's unit of work. */
export interface ResolveLabelSelectionTx {
  ships: Pick<ShipRepository, 'listActiveCarryingEvery' | 'findForShare'>;
}

/**
 * The ships a send to a label selection goes to, at send time (decision
 * 0065): every ship carrying each value that is not retired, awaiting crew or
 * crewed, never the viewer and never the sender. Each is held in id order as
 * a send holds the ship it addresses, so a retire waits for the send and a
 * ship retired before its hold is left out. No ship refuses the send.
 */
export async function resolveLabelSelection(
  tx: ResolveLabelSelectionTx,
  input: { fleetId: FleetId; valueIds: readonly LabelValueId[]; senderShipId: ShipId },
): Promise<Result<ShipId[], UnresolvableSelector>> {
  const { fleetId, senderShipId } = input;
  const selected = (await tx.ships.listActiveCarryingEvery(fleetId, input.valueIds))
    .map((ship) => ship.id)
    .filter((shipId) => shipId !== senderShipId)
    .sort();
  const resolved: ShipId[] = [];
  for (const shipId of selected) {
    const ship = await tx.ships.findForShare(fleetId, shipId);
    if (ship && addressShip(ship).isOk) {
      resolved.push(shipId);
    }
  }
  return resolved.length === 0 ? refuse('UNRESOLVABLE_SELECTOR', 'No ship but the sender carries every value of the label selection') : ok(resolved);
}
