import type { ReadReachOf } from '../registry/public.js';
import type { ShipCaller } from './caller.js';
import { eventsRead } from './events-read.js';
import type { FleetEventFeed, SequencedEvent } from './events.js';
import type { ShipHistory } from './history.js';

/**
 * The most missed events a browser is sent one by one. Further behind, loading
 * the fleet again is cheaper than replaying its history.
 */
export const REPLAY_LIMIT = 1000;

/**
 * What a browser does next: apply the events after its position, or load the
 * fleet again and follow from `seq`. The number is read before the browser
 * loads, so whatever commits in between is in what it loads or comes after.
 */
export type FleetEventsRead = { kind: 'events'; events: SequencedEvent[]; lastSeq: number } | { kind: 'resync'; seq: number };

export type ReadFleetEvents = (caller: ShipCaller, afterSeq: number | undefined) => Promise<FleetEventsRead>;

/**
 * Use case: the caller's fleet events after a position, for the live fleet
 * view. Without a position, or more than REPLAY_LIMIT behind, the browser is
 * told to load the fleet again. Only the events the caller reads (decision
 * 0034), with the number of the last it went through, read or not, to follow
 * from next. The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadFleetEvents(deps: { feed: FleetEventFeed; history: Pick<ShipHistory, 'messageParties'>; readReach: ReadReachOf }): ReadFleetEvents {
  const resync = async (caller: ShipCaller): Promise<FleetEventsRead> => ({
    kind: 'resync',
    seq: await deps.feed.lastSeq(caller.fleetId),
  });

  return async (caller, afterSeq) => {
    if (afterSeq === undefined) {
      return resync(caller);
    }
    const gone = await deps.feed.after(caller.fleetId, { seq: afterSeq, limit: REPLAY_LIMIT + 1 });
    if (gone.length > REPLAY_LIMIT) {
      return resync(caller);
    }
    const events = await eventsRead(deps, { fleetId: caller.fleetId, reach: await deps.readReach(caller), events: gone });
    return { kind: 'events', events, lastSeq: gone.at(-1)?.seq ?? afterSeq };
  };
}
