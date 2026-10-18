import type { FleetId } from '@aeolus-fleet/common';

import { readsEvent, type ReadReach } from '../registry/public.js';
import type { SequencedEvent } from './events.js';
import type { ShipHistory } from './history.js';

/**
 * The events a read reach reads (decision 0034): a message's through its
 * parties, any other through the ship it concerns, one that concerns neither
 * by every reader. In their order.
 */
export async function eventsRead(
  deps: { history: Pick<ShipHistory, 'messageParties'> },
  read: { fleetId: FleetId; reach: ReadReach; events: readonly SequencedEvent[] },
): Promise<SequencedEvent[]> {
  const { fleetId, reach, events } = read;
  if (reach.kind === 'every') {
    return [...events];
  }
  const parties = await deps.history.messageParties(
    fleetId,
    events.flatMap((event) => (event.messageId === undefined ? [] : [event.messageId])),
  );
  return events.filter((event) =>
    readsEvent(reach, { shipId: event.shipId ?? null, message: (event.messageId === undefined ? undefined : parties.get(event.messageId)) ?? null }),
  );
}
