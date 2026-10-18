import type { ShipId } from '@aeolus-fleet/common';

import type { Squadron } from './squadron.js';

/**
 * squadrons' limits on forming (question 9): configuration, never a policy of
 * who asks, binding every form and add, argo's in the console too. Each is
 * none while unset.
 */
export interface SquadronLimits {
  /** Squadrons not disbanded in a fleet. */
  perFleet: number | null;
  /** Squadrons not disbanded that one ship formed; argo is the forming ship of those it formed in the console. */
  perFormingShip: number | null;
  /** Members not retired nor being released in one squadron. */
  membersPerSquadron: number | null;
}

export const NO_LIMITS: SquadronLimits = { perFleet: null, perFormingShip: null, membersPerSquadron: null };

/** Why a new squadron would go over a limit, or undefined when it would not. */
export function formingOverLimit(
  limits: SquadronLimits,
  forming: { squadrons: readonly Squadron[]; formingShip: { shipId: ShipId; name: string } | null; members: number },
): string | undefined {
  const sailing = forming.squadrons.filter((each) => each.state !== 'disbanded');
  if (limits.perFleet !== null && sailing.length >= limits.perFleet) {
    return `The fleet is at squadrons' limit of ${String(limits.perFleet)} squadrons`;
  }
  const formingShipId = forming.formingShip?.shipId ?? null;
  if (limits.perFormingShip !== null && sailing.filter((each) => (each.formingShip?.shipId ?? null) === formingShipId).length >= limits.perFormingShip) {
    return `${forming.formingShip?.name ?? 'argo'} is at squadrons' limit of ${String(limits.perFormingShip)} squadrons per forming ship`;
  }
  if (limits.membersPerSquadron !== null && forming.members > limits.membersPerSquadron) {
    return `The blueprint forms ${String(forming.members)} members, over squadrons' limit of ${String(limits.membersPerSquadron)} per squadron`;
  }
  return undefined;
}

/** Why one more member would go over the limit per squadron, or undefined when it would not. */
export function addingOverLimit(limits: SquadronLimits, squadron: Squadron): string | undefined {
  const serving = squadron.members.filter((each) => each.retiredAt === null && each.releasingSince === null).length;
  return limits.membersPerSquadron !== null && serving >= limits.membersPerSquadron
    ? `The squadron ${squadron.id} is at squadrons' limit of ${String(limits.membersPerSquadron)} members`
    : undefined;
}
