import type { ShipId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import type { ShipHistory, TimelineEntry } from './history.js';
import { ok, type Result } from './result.js';

/** The most events a timeline shows: the newest ones. */
export const TIMELINE_LIMIT = 200;

export type ReadShipTimeline = (
  caller: Caller,
  input: { shipId: ShipId },
) => Promise<Result<TimelineEntry[], DomainError<'SHIP_NOT_FOUND'>>>;

/**
 * Use case: every change to a ship, newest first: the events naming it and
 * the ones it caused, such as the messages it sent. The caller's scope
 * (fleet:read) is checked before this runs.
 */
export function createReadShipTimeline(deps: { history: ShipHistory }): ReadShipTimeline {
  return async (caller, { shipId }) => {
    const timeline = await deps.history.timeline(caller.fleetId, { shipId, limit: TIMELINE_LIMIT });
    return timeline ? ok(timeline) : refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
  };
}
