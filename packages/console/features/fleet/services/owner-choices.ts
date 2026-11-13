import type { ShipId } from '@aeolus-fleet/common';

/** A person ship that may own what argo commissions, by id and name. */
export interface OwnerChoice {
  id: ShipId;
  name: string;
}

/**
 * The person ships argo may name as owner: the active ones among those found,
 * and the one argo named last even when the search found does not hold it.
 * Undefined while nothing is known yet.
 */
export function ownerChoicesOf(
  found: readonly { id: ShipId; name: string; status: string }[] | undefined,
  lastNamed: OwnerChoice | undefined,
): OwnerChoice[] | undefined {
  const active = found?.filter((ship) => ship.status !== 'retired').map((ship) => ({ id: ship.id, name: ship.name }));
  if (lastNamed === undefined || active?.some((choice) => choice.id === lastNamed.id) === true) {
    return active;
  }
  return [...(active ?? []), lastNamed];
}
