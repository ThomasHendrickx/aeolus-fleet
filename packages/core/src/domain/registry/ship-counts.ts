/**
 * The fleet's ship counts per kind (performance design, decision 2): what the
 * overview's cards, its subtitle and the navigation's needs-crew count show,
 * counted without reading every ship's row.
 */
import { SHIP_KINDS, type ShipId, type ShipKind } from '@aeolus-fleet/common';
import { isNeedingCrew } from '@aeolus-fleet/common/rules';

import type { ListedShip } from './list-fleet.js';

/** The ships of one kind: how many are active (not retired), crewed, awaiting crew, retired and needing crew, and which awaited crew longest. */
export interface ShipCounts {
  kind: ShipKind;
  active: number;
  crewed: number;
  awaitingCrew: number;
  retired: number;
  /** Needing crew with the trierarch plugin connected, and without it. */
  needsCrew: { withTrierarchs: number; withoutTrierarchs: number };
  /** The active ship of the kind that has awaited crew longest; none while none awaits crew. */
  longestWait: { id: ShipId; name: string; awaitingCrewSince: Date } | null;
}

/** Counts the ships per kind, in the kinds' order, only the kinds there are. */
export function shipCountsOf(ships: readonly ListedShip[]): ShipCounts[] {
  return SHIP_KINDS.flatMap((kind): ShipCounts[] => {
    const ofKind = ships.filter((ship) => ship.kind === kind);
    if (ofKind.length === 0) {
      return [];
    }
    const awaiting = ofKind.filter((ship) => ship.status === 'awaitingCrew');
    const [longest] = awaiting
      .flatMap((ship) => (ship.awaitingCrewSince === null ? [] : [{ id: ship.id, name: ship.name, awaitingCrewSince: ship.awaitingCrewSince }]))
      .toSorted((first, second) => first.awaitingCrewSince.getTime() - second.awaitingCrewSince.getTime() || first.id.localeCompare(second.id));
    return [
      {
        kind,
        active: ofKind.filter((ship) => ship.status !== 'retired').length,
        crewed: ofKind.filter((ship) => ship.status === 'crewed').length,
        awaitingCrew: awaiting.length,
        retired: ofKind.filter((ship) => ship.status === 'retired').length,
        needsCrew: {
          withTrierarchs: ofKind.filter((ship) => isNeedingCrew(ship, { hasTrierarchs: true })).length,
          withoutTrierarchs: ofKind.filter((ship) => isNeedingCrew(ship, { hasTrierarchs: false })).length,
        },
        longestWait: longest ?? null,
      },
    ];
  });
}
