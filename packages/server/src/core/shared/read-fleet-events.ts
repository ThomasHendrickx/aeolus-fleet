import type { Caller } from './caller.js';
import type { FleetEventFeed, SequencedEvent } from './events.js';

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
export type FleetEventsRead = { kind: 'events'; events: SequencedEvent[] } | { kind: 'resync'; seq: number };

export type ReadFleetEvents = (caller: Caller, afterSeq: number | undefined) => Promise<FleetEventsRead>;

/**
 * Use case: the caller's fleet events after a position, for the live fleet
 * view. Without a position, or more than REPLAY_LIMIT behind, the browser is
 * told to load the fleet again. The caller's scope (fleet:read) is checked
 * before this runs.
 */
export function createReadFleetEvents(deps: { feed: FleetEventFeed }): ReadFleetEvents {
  const resync = async (caller: Caller): Promise<FleetEventsRead> => ({
    kind: 'resync',
    seq: await deps.feed.lastSeq(caller.fleetId),
  });

  return async (caller, afterSeq) => {
    if (afterSeq === undefined) {
      return resync(caller);
    }
    const events = await deps.feed.after(caller.fleetId, { seq: afterSeq, limit: REPLAY_LIMIT + 1 });
    return events.length > REPLAY_LIMIT ? resync(caller) : { kind: 'events', events };
  };
}
