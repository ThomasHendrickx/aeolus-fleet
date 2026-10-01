import type { InboxFilter } from '@aeolus-fleet/common';

import type { Caller } from './caller.js';
import type { InboxEntry, ShipHistory } from './history.js';

export type ReadInbox = (caller: Caller, input: { filter: InboxFilter }) => Promise<InboxEntry[]>;

/**
 * Use case: the caller's own inbox, for the operator inbox of argo
 * (docs/blueprint.md, "Inbox"): the messages addressed to it that the filter
 * keeps (open, done or all), newest first, each with when it was read, when
 * and by which reply it was done, and its whole payload. Messages to its type
 * are its type's queue, not its inbox. The caller's scope (fleet:read) is
 * checked before this runs.
 */
export function createReadInbox(deps: { history: ShipHistory }): ReadInbox {
  return (caller, { filter }) => deps.history.inbox(caller.fleetId, { shipId: caller.shipId, filter });
}
