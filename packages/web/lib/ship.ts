import { idSchema, type MessageId, type ShipDetail, type ShipId } from '@aeolus-fleet/common';
import { skipToken, useQueries, useQuery } from '@tanstack/react-query';

import { LAST_SEEN_REFRESH_MS } from './fleet';
import { useTRPC } from './trpc';

/**
 * One ship for its page, or for a dialog's numbers: the overview's facts,
 * when it was commissioned, crewed and retired, and its deliveries in flight
 * and open. Idle while no ship is given.
 */
export function useShip(shipId: ShipId | undefined) {
  const trpc = useTRPC();
  return useQuery(
    trpc.fleet.ship.queryOptions(shipId === undefined ? skipToken : { shipId }, { refetchInterval: LAST_SEEN_REFRESH_MS }),
  );
}

/**
 * Several ships as their pages read them, by id: for a squadron's members,
 * their report, location and open deliveries. An id that is no ship id is
 * left out.
 */
export function useShips(shipIds: readonly string[]): ReadonlyMap<string, ShipDetail> {
  const trpc = useTRPC();
  const ids = shipIds.flatMap((shipId) => {
    const parsed = idSchema('ship').safeParse(shipId);
    return parsed.success ? [parsed.data] : [];
  });
  const ships = useQueries({ queries: ids.map((shipId) => trpc.fleet.ship.queryOptions({ shipId }, { refetchInterval: LAST_SEEN_REFRESH_MS })) });
  const byId = new Map<string, ShipDetail>();
  for (const ship of ships) {
    if (ship.data) {
      byId.set(ship.data.id, ship.data);
    }
  }
  return byId;
}

/** Every change to the ship, newest first. */
export function useShipTimeline(shipId: ShipId) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.shipTimeline.queryOptions({ shipId }));
}

/** The messages the ship sent, was sent, or claimed as a ship of their type. */
export function useShipMessages(shipId: ShipId) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.shipMessages.queryOptions({ shipId }));
}

/** One message with its delivery's history; idle while no message is open. */
export function useMessage(messageId: MessageId | undefined) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.message.queryOptions(messageId === undefined ? skipToken : { messageId }));
}
