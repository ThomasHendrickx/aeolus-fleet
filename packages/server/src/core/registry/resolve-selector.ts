import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Recipient, Selector } from '../shared/selector.js';
import type { ShipRepository } from './ports.js';
import { addressShip } from './ship.js';

/** The ports resolving a selector reads, inside the caller's unit of work. */
export interface ResolveSelectorTx {
  ships: Pick<ShipRepository, 'findForShare' | 'findActiveByNameForShare' | 'hasActiveShipOfType'>;
}

export type UnresolvableSelector = DomainError<'UNRESOLVABLE_SELECTOR'>;

/**
 * Who a selector resolves to in the fleet, at send time: Messaging's one
 * question to Registry (docs/blueprint.md, "Domain architecture"). A ship, by
 * id or by name, must exist in the fleet and not be retired; a name resolves
 * to that ship's id. A type needs at least one ship of the fleet with that
 * type that is not retired, awaiting crew or crewed.
 *
 * The ship a message is addressed to stays held until the unit of work ends,
 * so a retire and a send never pass each other. A type is not held: a retire
 * never abandons a type delivery, which any ship of that type can still take.
 */
export async function resolveSelector(
  tx: ResolveSelectorTx,
  input: { fleetId: FleetId; selector: Selector },
): Promise<Result<Recipient, UnresolvableSelector>> {
  const { fleetId, selector } = input;
  switch (selector.kind) {
    case 'ship': {
      if ('shipId' in selector) {
        const ship = await tx.ships.findForShare(fleetId, selector.shipId);
        return ship ? addressShip(ship) : refuse('UNRESOLVABLE_SELECTOR', `Ship ${selector.shipId} does not exist`);
      }
      const ship = await tx.ships.findActiveByNameForShare(fleetId, selector.name);
      return ship ? addressShip(ship) : refuse('UNRESOLVABLE_SELECTOR', `No active ship is named ${selector.name}`);
    }
    case 'type':
      return (await tx.ships.hasActiveShipOfType(fleetId, selector.type))
        ? ok({ kind: 'type', type: selector.type })
        : refuse('UNRESOLVABLE_SELECTOR', `No active ship has the type ${selector.type}`);
  }
}
