import type { ShipStatus } from '@aeolus-fleet/common';

/**
 * Connecting squadrons from the console (decision 0017): the web app's server
 * commissions the management ship, or gives the one it had a new starting
 * prompt, and hands its secret to squadrons, server to server. The secret
 * never leaves the one request that carries it; the browser sees only the
 * connection's new state.
 */

/** The management ship's name and type: infrastructure, fixed, never the operator's to choose. */
export const MANAGEMENT_SHIP = 'squadrons';

export interface SquadronsConnection {
  state: 'not-connected' | 'connected';
  ship: { shipId: string; name: string } | null;
  lastShipId: string | null;
}

/** The calls connecting makes, each with the operator's console session; a refusal throws. */
export interface ConnectCalls {
  status(): Promise<SquadronsConnection>;
  connect(handOver: { shipId: string; secret: string }): Promise<SquadronsConnection>;
  ships(): Promise<{ id: string; name: string; type: string; status: ShipStatus }[]>;
  commission(ship: { name: string; type: string; fleetScopes: ('fleet:read' | 'fleet:manage')[]; idempotencyKey: string }): Promise<{ shipId: string; secret: string | null }>;
  release(shipId: string): Promise<void>;
  startingPrompt(shipId: string): Promise<{ secret: string }>;
}

/** A refusal to show the operator as it is: it names what to do. */
export class ConnectSquadronsError extends Error {
  override name = 'ConnectSquadronsError';
}

/**
 * Connects squadrons, unless it is connected already. The ship is the one
 * squadrons was last connected as while it is still active, else an active
 * ship named squadrons of type squadrons, else a new one with fleet:read and
 * fleet:manage. A crewed one is released first (its session is gone: squadrons
 * holds no token), and an existing one gets a new starting prompt, so a
 * connect that failed halfway is finished by the next one.
 */
export async function connectSquadrons(calls: ConnectCalls, newKey: () => string): Promise<SquadronsConnection> {
  const status = await calls.status();
  if (status.state === 'connected') {
    return status;
  }
  const active = (await calls.ships()).filter((ship) => ship.status !== 'retired');
  const last = active.find((ship) => ship.id === status.lastShipId);
  const named = active.find((ship) => ship.name === MANAGEMENT_SHIP);
  if (!last && named && named.type !== MANAGEMENT_SHIP) {
    throw new ConnectSquadronsError(`A ship named ${MANAGEMENT_SHIP} of another type exists: rename or retire it, then connect again`);
  }
  const ship = last ?? named;

  let shipId: string;
  let secret: string;
  if (ship) {
    if (ship.status === 'crewed') {
      await calls.release(ship.id);
    }
    shipId = ship.id;
    secret = (await calls.startingPrompt(ship.id)).secret;
  } else {
    const commissioned = await calls.commission({ name: MANAGEMENT_SHIP, type: MANAGEMENT_SHIP, fleetScopes: ['fleet:read', 'fleet:manage'], idempotencyKey: newKey() });
    shipId = commissioned.shipId;
    secret = commissioned.secret ?? (await calls.startingPrompt(commissioned.shipId)).secret;
  }
  return calls.connect({ shipId, secret });
}
