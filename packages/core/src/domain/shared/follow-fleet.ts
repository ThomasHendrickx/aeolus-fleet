import { FOLLOW_MAX_DEFAULT, FOLLOW_MAX_LIMIT } from '@aeolus-fleet/common';

import type { ReadReachOf } from '../registry/public.js';
import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import { eventsRead } from './events-read.js';
import type { FleetEventFeed, SequencedEvent } from './events.js';
import type { ShipHistory } from './history.js';
import { ok, type Result } from './result.js';

export type FollowFleetRefusal = DomainError<'INVALID_FOLLOW_MAX'>;

export interface FleetFollowed {
  /** The events after the position, oldest first. */
  events: SequencedEvent[];
  /** The number to follow from next: the last event's it went through, read or not; when none came, the position itself, or the fleet's last when the position is past it, as after a restore; or the newest without one. */
  lastSeq: number;
}

export type FollowFleet = (
  caller: Caller,
  input: { afterSeq?: number; max?: number },
) => Promise<Result<FleetFollowed, FollowFleetRefusal>>;

function checkedMax(max: number | undefined): Result<number, FollowFleetRefusal> {
  const value = max ?? FOLLOW_MAX_DEFAULT;
  return Number.isInteger(value) && value >= 1 && value <= FOLLOW_MAX_LIMIT
    ? ok(value)
    : refuse('INVALID_FOLLOW_MAX', `max is 1 to ${String(FOLLOW_MAX_LIMIT)} events`);
}

/**
 * Use case: a client with fleet:read follows the fleet's committed events
 * (`fleet.follow`) by the same commit-ordered numbers the console follows by,
 * so it misses none across reconnects: it passes the `lastSeq` it was answered
 * as `afterSeq` next. Without a position it learns where to start from. It
 * answers at once, with none when nothing came: no call waits (decision 0072);
 * the live stream `fleet.events` pushes. A position past the fleet's last
 * event, as after a restore, is answered the fleet's last position, with no
 * events, so the follower goes on from there. It answers only the events the
 * caller reads (decision 0034); one it does not read moves the position on.
 * The caller's scope is checked before this runs.
 */
export function createFollowFleet(deps: {
  feed: FleetEventFeed;
  history: Pick<ShipHistory, 'messageParties'>;
  readReach: ReadReachOf;
}): FollowFleet {
  return async (caller, input) => {
    const max = checkedMax(input.max);
    if (!max.isOk) {
      return max;
    }
    const { fleetId } = caller;
    const { afterSeq } = input;
    if (afterSeq === undefined) {
      return ok({ events: [], lastSeq: await deps.feed.lastSeq(fleetId) });
    }

    const gone = await deps.feed.after(fleetId, { seq: afterSeq, limit: max.value });
    if (gone.length === 0) {
      // A position past the fleet's last event, as a follower holds after a restore set the fleet back, goes on from the fleet's last.
      const last = await deps.feed.lastSeq(fleetId);
      return ok({ events: [], lastSeq: Math.min(afterSeq, last) });
    }
    const reach = await deps.readReach(caller);
    const events = await eventsRead(deps, { fleetId, reach, events: gone });
    return ok({ events, lastSeq: gone.at(-1)?.seq ?? afterSeq });
  };
}
