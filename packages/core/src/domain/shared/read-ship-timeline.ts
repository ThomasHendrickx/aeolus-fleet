import { PAGE_SIZE_DEFAULT, type EventId, type ShipId } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import { refuse, type DomainError } from './errors.js';
import { readsEvent, type ReadReachOf } from '../registry/public.js';
import { partiesOf, withPing, type ShipHistory, type ShownTimelineEntry } from './history.js';
import type { Page } from './page.js';
import { ok, type Result } from './result.js';

export type ReadShipTimeline = (
  caller: Caller,
  input: { shipId: ShipId; cursor?: EventId; limit?: number },
) => Promise<Result<Page<ShownTimelineEntry, EventId>, DomainError<'SHIP_NOT_FOUND'>>>;

/**
 * Use case: a page of every change to a ship, newest first: the events naming it and
 * the ones it caused, such as the messages it sent, each message telling
 * whether it is a ping. Only the events the caller reads (decision 0034): a
 * message's through the message, its ship standing for who claimed one to a
 * type. The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadShipTimeline(deps: { history: ShipHistory; readReach: ReadReachOf }): ReadShipTimeline {
  return async (caller, { shipId, cursor, limit = PAGE_SIZE_DEFAULT }) => {
    const timeline = await deps.history.timeline(caller.fleetId, { shipId, cursor, limit });
    if (!timeline) {
      return refuse('SHIP_NOT_FOUND', `No ship ${shipId} in this fleet`);
    }
    const reach = await deps.readReach(caller);
    const read = timeline.items.filter((entry) => readsEvent(reach, { type: entry.type, shipId: entry.ship?.id ?? null, message: entry.message && partiesOf(entry.message, entry.ship) }));
    return ok({ items: read.map((entry) => ({ ...entry, message: entry.message === null ? null : withPing(entry.message) })), nextCursor: timeline.nextCursor });
  };
}
