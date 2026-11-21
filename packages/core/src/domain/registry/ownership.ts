/** Validates an owner chain by indexed fleet-scoped reads under the ownership lock. */
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ShipRepository } from './ports.js';
import { isEligibleOwner } from './ship.js';

export type OwnershipRefusal = DomainError<'INVALID_OWNER' | 'OWNERSHIP_CYCLE'>;

/** A person self-root and argo terminate a chain; any other repetition is a cycle. */
export async function validateOwnership(ships: Pick<ShipRepository, 'find'>, ref: { fleetId: FleetId; shipId: ShipId; ownerShipId: ShipId }): Promise<Result<undefined, OwnershipRefusal>> {
  const visited = new Set<ShipId>([ref.shipId]);
  let next: ShipId = ref.ownerShipId;
  for (;;) {
    if (visited.has(next)) {
      return refuse('OWNERSHIP_CYCLE', 'The proposed owner chain contains an ownership cycle');
    }
    visited.add(next);
    const owner = await ships.find(ref.fleetId, next);
    if (owner?.retiredAt !== null || !isEligibleOwner(owner)) {
      return refuse('INVALID_OWNER', 'The owner chain must contain active eligible ships in this fleet');
    }
    if ((owner.kind === 'operator' && owner.owner === null) || (owner.kind === 'person' && owner.owner === owner.id)) {
      return ok(undefined);
    }
    if (owner.owner === null) {
      return refuse('INVALID_OWNER', 'The owner chain must end at argo or a person ship');
    }
    next = owner.owner;
  }
}
