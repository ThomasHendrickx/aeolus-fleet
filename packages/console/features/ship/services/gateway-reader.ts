import type { ComputerSide, ShipKind } from '@aeolus-fleet/common';

import { GATEWAY_SHIP } from '../../../lib/connect-plugin';
import type { ShownConnection } from '../../../lib/shown-connection';

/** The gateway's plugin ship as the mark names it: by id and name when the console knows its connection, else by its name alone. */
export interface GatewayShip {
  shipId?: string;
  name: string;
}

/** Why the gateway reads a ship's payloads: it crews the ship, or the ship is its proxy ship for an outside party. */
export interface GatewayReader {
  as: 'crew' | 'proxyShip';
  gateway: GatewayShip;
}

/** The gateway's plugin ship from its connection: the ship it is connected as, or was last; none while the console knows of none. */
export function gatewayShipOf(connection: ShownConnection | undefined): GatewayShip | undefined {
  if (connection === undefined || connection.state === 'none') {
    return undefined;
  }
  if (connection.ship !== null) {
    return connection.ship;
  }
  return connection.lastShipId === null ? undefined : { shipId: connection.lastShipId, name: GATEWAY_SHIP.name };
}

/**
 * The gateway mark (decision 0068, B19, D4): in a sealed fleet, the gateway
 * reads a ship's payloads when it is the gateway's proxy ship (an app ship
 * the gateway's ship commissioned, 0056) or when the gateway crews it (its
 * lease's waker is the gateway, 0040). None in a fleet without sealing.
 */
export function gatewayReaderOf(of: {
  isSealed: boolean;
  ship: { kind: ShipKind; commissionedByShipId: string | null };
  /** What serves the ship's open lease; null without one. */
  leaseBy: ComputerSide | null;
  gateway: GatewayShip | undefined;
}): GatewayReader | undefined {
  if (!of.isSealed) {
    return undefined;
  }
  const { gateway } = of;
  if (gateway?.shipId !== undefined && of.ship.kind === 'app' && of.ship.commissionedByShipId === gateway.shipId) {
    return { as: 'proxyShip', gateway };
  }
  return of.leaseBy?.kind === 'gateway' ? { as: 'crew', gateway: gateway ?? { name: GATEWAY_SHIP.name } } : undefined;
}
