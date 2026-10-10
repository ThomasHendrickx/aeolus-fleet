import type { ListedShip, ShipId } from '@aeolus-fleet/common';

/**
 * The fleet graph's reach mode (design point 12 on #260): the fleet's ships
 * placed on a circle, argo at the top and the others by name; argo picks a
 * ship and the ships it reaches stand out while the others dim. What a ship
 * reaches comes from the fleet's explain call, never worked out here: the
 * browser holds no rules (decision 0033).
 */

/** A ship as the graph draws it. */
export interface GraphShip {
  id: ShipId;
  name: string;
  isOperator: boolean;
}

/** How a ship stands while argo looks at the reach of one: picked, reached, out of reach, or not yet known. */
export type ReachMark = 'picked' | 'reached' | 'unreached' | 'none';

/** A ship on the graph: where it sits, in percent of the graph's width and height, and how it stands. */
export interface GraphNode {
  ship: GraphShip;
  x: number;
  y: number;
  mark: ReachMark;
}

/** What the explain call answered for the picked ship, while it is known. */
export interface Reach {
  pickedShipId: ShipId;
  reachableShipIds: readonly ShipId[] | undefined;
}

const CENTRE = 50;
/** The circle's radius in percent, leaving room for a ship's name at the edge. */
const RADIUS = 38;
/** The first ship sits at the top. */
const START_ANGLE = -Math.PI / 2;
const FULL_TURN = 2 * Math.PI;
/** Positions rounded to hundredths of a percent, so the same fleet draws the same graph. */
const PRECISION = 100;

/** The ships the graph draws: the fleet's ships that sail, argo first, then by name; never retired ones or the viewer ship. */
export function graphShipsOf(ships: readonly ListedShip[]): GraphShip[] {
  return ships
    .filter((ship) => ship.status !== 'retired' && ship.kind !== 'viewer')
    .map((ship) => ({ id: ship.id, name: ship.name, isOperator: ship.kind === 'operator' }))
    .sort((first, second) => Number(second.isOperator) - Number(first.isOperator) || first.name.localeCompare(second.name));
}

/** Each ship placed evenly on the circle, with its mark for the picked ship's reach. */
export function graphNodesOf(ships: readonly GraphShip[], reach: Reach | undefined): GraphNode[] {
  return ships.map((ship, index) => {
    const angle = START_ANGLE + (FULL_TURN * index) / ships.length;
    const isAlone = ships.length === 1;
    return {
      ship,
      x: isAlone ? CENTRE : rounded(CENTRE + RADIUS * Math.cos(angle)),
      y: isAlone ? CENTRE : rounded(CENTRE + RADIUS * Math.sin(angle)),
      mark: markOf(ship.id, reach),
    };
  });
}

function markOf(shipId: ShipId, reach: Reach | undefined): ReachMark {
  if (reach === undefined) {
    return 'none';
  }
  if (shipId === reach.pickedShipId) {
    return 'picked';
  }
  if (reach.reachableShipIds === undefined) {
    return 'none';
  }
  return reach.reachableShipIds.includes(shipId) ? 'reached' : 'unreached';
}

function rounded(percent: number): number {
  return Math.round(percent * PRECISION) / PRECISION;
}

/** The sentence under the graph: what the picked ship reaches, in words, so the marks never rest on look alone. */
export function reachSummaryOf(nodes: readonly GraphNode[]): string {
  const picked = nodes.find((node) => node.mark === 'picked');
  if (picked === undefined) {
    return 'Pick a ship to see which ships it may message.';
  }
  const others = nodes.length - 1;
  const reached = nodes.filter((node) => node.mark === 'reached').map((node) => node.ship.name);
  if (nodes.every((node) => node.mark === 'picked' || node.mark === 'none')) {
    return others === 0 ? `${picked.ship.name} is the only ship of the fleet.` : `Finding the ships ${picked.ship.name} may message…`;
  }
  if (reached.length === others) {
    return `${picked.ship.name} may message every other ship (${String(others)}).`;
  }
  if (reached.length === 0) {
    return `${picked.ship.name} may message no other ship.`;
  }
  return `${picked.ship.name} may message ${String(reached.length)} of ${String(others)} ships: ${reached.join(', ')}.`;
}
