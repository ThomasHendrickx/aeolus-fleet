import type { MessageId, ShipDetail, ShipId } from '@aeolus-fleet/common';
import { isInReadReach } from '@aeolus-fleet/common/rules';
import { skipToken, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';

import { LAST_SEEN_REFRESH_MS } from './fleet';
import { CONSOLE_PAGE_SIZE, nextCursorOf, pagedListOf } from './paged-list';
import { useTRPC } from './trpc';

/**
 * One ship for its page, or for a dialog's numbers: the overview's facts,
 * when it was commissioned, crewed and retired, and its deliveries in flight
 * and open. Idle while no ship is given; null for a ship the session does not
 * read whole (decision 0034).
 */
export function useShip(shipId: ShipId | undefined) {
  const trpc = useTRPC();
  return useQuery(
    trpc.fleet.ship.queryOptions(shipId === undefined ? skipToken : { shipId }, {
      refetchInterval: LAST_SEEN_REFRESH_MS,
      select: (ship): ShipDetail | null => (isInReadReach(ship) ? ship : null),
    }),
  );
}

/**
 * Several ships as their pages read them, by id: for a squadron's members,
 * their report, location and open deliveries.
 */
export function useShips(shipIds: readonly ShipId[]): ReadonlyMap<string, ShipDetail> {
  const trpc = useTRPC();
  const ships = useQueries({ queries: shipIds.map((shipId) => trpc.fleet.ship.queryOptions({ shipId }, { refetchInterval: LAST_SEEN_REFRESH_MS })) });
  const byId = new Map<string, ShipDetail>();
  for (const ship of ships) {
    if (ship.data && isInReadReach(ship.data)) {
      byId.set(ship.data.id, ship.data);
    }
  }
  return byId;
}

/** Every change to the ship, newest first, a page at a time. */
export function useShipTimeline(shipId: ShipId) {
  const trpc = useTRPC();
  return pagedListOf(useInfiniteQuery(trpc.fleet.shipTimeline.infiniteQueryOptions({ shipId, limit: CONSOLE_PAGE_SIZE }, { getNextPageParam: nextCursorOf })));
}

/** The messages the ship sent, was sent, or claimed as a ship of their type, newest first, a page at a time. */
export function useShipMessages(shipId: ShipId) {
  const trpc = useTRPC();
  return pagedListOf(useInfiniteQuery(trpc.fleet.shipMessages.infiniteQueryOptions({ shipId, limit: CONSOLE_PAGE_SIZE }, { getNextPageParam: nextCursorOf })));
}

/** One message with its delivery's history; idle while no message is open. */
export function useMessage(messageId: MessageId | undefined) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.message.queryOptions(messageId === undefined ? skipToken : { messageId }));
}

/** A ship's side of the way: the part that serves it, its turn and its oldest delivery waiting (#756). */
export function useShipWay(shipId: ShipId) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.shipWay.queryOptions({ shipId }, { refetchInterval: LAST_SEEN_REFRESH_MS }));
}
