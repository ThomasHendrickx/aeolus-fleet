import type { ListedShip, ShipId, ShipKind, ShipOutsideReadReach } from '@aeolus-fleet/common';
import { isInReadReach } from '@aeolus-fleet/common/rules';

/**
 * Harbour (docs/design/fleet-overview): the fleet in four states, one tile per
 * ship grouped by kind. The blueprint gives each ship its facts (status from
 * the lease, the crew's report, its open alerts, decision 0071) but no four
 * states; the build's mapping, first match wins: an open alert is Alert;
 * awaiting crew or a blocked report is Waiting; a working report is Working;
 * anything else (an idle report, or none yet) is Idle.
 */
export const HARBOUR_STATES = ['alert', 'waiting', 'working', 'idle'] as const;

export type HarbourState = (typeof HARBOUR_STATES)[number];

export const HARBOUR_GROUPS = ['people', 'agents', 'plugins', 'gateway'] as const;

export type HarbourGroupKind = (typeof HARBOUR_GROUPS)[number];

export interface HarbourTile {
  id: ShipId;
  name: string;
  state: HarbourState;
  /** What the ship is doing: its report's note; null before it reports or without a note. */
  note: string | null;
}

export interface HarbourGroup {
  kind: HarbourGroupKind;
  tiles: HarbourTile[];
}

export interface Harbour {
  counts: { ships: number } & Record<HarbourState, number>;
  /** Only the kinds with a ship, in the order of HARBOUR_GROUPS. */
  groups: HarbourGroup[];
}

/** Which group a ship's kind lands in; the viewer ship is the console's own and shows in none. */
const GROUP_OF_KIND: Record<ShipKind, HarbourGroupKind | null> = {
  operator: 'people',
  person: 'people',
  agent: 'agents',
  plugin: 'plugins',
  app: 'gateway',
  viewer: null,
};

function stateOf(ship: ListedShip): HarbourState {
  if (ship.openAlertCount > 0) {
    return 'alert';
  }
  if (ship.status === 'awaitingCrew' || ship.report?.state === 'blocked') {
    return 'waiting';
  }
  return ship.report?.state === 'working' ? 'working' : 'idle';
}

function byStateThenName(first: HarbourTile, second: HarbourTile): number {
  return HARBOUR_STATES.indexOf(first.state) - HARBOUR_STATES.indexOf(second.state) || first.name.localeCompare(second.name);
}

/**
 * The numbers and the groups from the fleet's ships as `fleet.list` lists
 * them: the active ships read whole; retired ships, the viewer ship and ships
 * outside read reach (no kind, no report: decision 0034) are left out.
 */
export function harbourOf(ships: readonly (ListedShip | ShipOutsideReadReach)[]): Harbour {
  const tiled = ships.flatMap((ship) => {
    if (!isInReadReach(ship) || ship.status === 'retired') {
      return [];
    }
    const group = GROUP_OF_KIND[ship.kind];
    return group === null ? [] : [{ group, tile: { id: ship.id, name: ship.name, state: stateOf(ship), note: ship.report?.note ?? null } }];
  });
  const counts = { ships: tiled.length, alert: 0, waiting: 0, working: 0, idle: 0 };
  for (const { tile } of tiled) {
    counts[tile.state] += 1;
  }
  const groups = HARBOUR_GROUPS.flatMap((kind) => {
    const tiles = tiled.filter((each) => each.group === kind).map((each) => each.tile);
    return tiles.length === 0 ? [] : [{ kind, tiles: tiles.toSorted(byStateThenName) }];
  });
  return { counts, groups };
}
