import type { MessageId, ShipId } from '@aeolus-fleet/common';
import { skipToken, useQuery } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/** One ship for its page: the overview's facts, with when it was commissioned, crewed and retired. */
export function useShip(shipId: ShipId) {
  const trpc = useTRPC();
  return useQuery(trpc.fleet.ship.queryOptions({ shipId }));
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
