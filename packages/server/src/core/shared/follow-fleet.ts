import { FOLLOW_MAX_DEFAULT, FOLLOW_MAX_LIMIT, FOLLOW_WAIT_MAX_SECONDS } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import type { Clock } from './clock.js';
import { refuse, type DomainError } from './errors.js';
import type { FleetEventFeed, FleetEventWakeups, FleetNewsWatch, SequencedEvent } from './events.js';
import { ok, type Result } from './result.js';

const SECOND_MS = 1_000;

export type FollowFleetRefusal = DomainError<'INVALID_FOLLOW_MAX' | 'INVALID_FOLLOW_WAIT'>;

export interface FleetFollowed {
  /** The events after the position, oldest first. */
  events: SequencedEvent[];
  /** The number to follow from next: the last event's, the position itself when none came, or the newest without one. */
  lastSeq: number;
}

export type FollowFleet = (
  caller: Caller,
  input: { afterSeq?: number; max?: number; waitSeconds?: number },
) => Promise<Result<FleetFollowed, FollowFleetRefusal>>;

function checkedMax(max: number | undefined): Result<number, FollowFleetRefusal> {
  const value = max ?? FOLLOW_MAX_DEFAULT;
  return Number.isInteger(value) && value >= 1 && value <= FOLLOW_MAX_LIMIT
    ? ok(value)
    : refuse('INVALID_FOLLOW_MAX', `max is 1 to ${String(FOLLOW_MAX_LIMIT)} events`);
}

function checkedWaitMs(waitSeconds: number | undefined): Result<number, FollowFleetRefusal> {
  const value = waitSeconds ?? 0;
  return Number.isInteger(value) && value >= 0 && value <= FOLLOW_WAIT_MAX_SECONDS
    ? ok(value * SECOND_MS)
    : refuse('INVALID_FOLLOW_WAIT', `waitSeconds is 0 to ${String(FOLLOW_WAIT_MAX_SECONDS)}`);
}

/**
 * Use case: a client with fleet:read follows the fleet's committed events
 * (`fleet.follow`) by the same commit-ordered numbers the console follows by,
 * so it misses none across reconnects: it passes the `lastSeq` it was answered
 * as `afterSeq` next. Without a position it learns where to start from. With a
 * wait, and nothing after the position, it watches its fleet's wake-ups and
 * reads again on each until an event comes or the wait has passed; it starts
 * watching before it reads a second time, so an event committed in between is
 * answered. The caller's scope is checked before this runs.
 */
export function createFollowFleet(deps: { feed: FleetEventFeed; clock: Clock; wakeups: FleetEventWakeups }): FollowFleet {
  return async (caller, input) => {
    const max = checkedMax(input.max);
    if (!max.isOk) {
      return max;
    }
    const waitMs = checkedWaitMs(input.waitSeconds);
    if (!waitMs.isOk) {
      return waitMs;
    }
    const { fleetId } = caller;
    const { afterSeq } = input;
    if (afterSeq === undefined) {
      return ok({ events: [], lastSeq: await deps.feed.lastSeq(fleetId) });
    }

    const until = deps.clock.now().getTime() + waitMs.value;
    let watch: FleetNewsWatch | undefined;
    try {
      for (;;) {
        const events = await deps.feed.after(fleetId, { seq: afterSeq, limit: max.value });
        const remainingMs = until - deps.clock.now().getTime();
        if (events.length > 0 || remainingMs <= 0) {
          return ok({ events, lastSeq: events.at(-1)?.seq ?? afterSeq });
        }
        if (watch === undefined) {
          watch = deps.wakeups.watch(fleetId);
          continue;
        }
        if ((await watch.next(remainingMs)) === 'timedOut') {
          return ok({ events: [], lastSeq: afterSeq });
        }
      }
    } finally {
      watch?.stop();
    }
  };
}
