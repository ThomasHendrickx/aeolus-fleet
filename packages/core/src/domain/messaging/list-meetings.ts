/** A ship rediscovers its readable meetings, including those it left or was revoked from. */
import { MEETINGS_PAGE_SIZE_DEFAULT, type MeetingsInput } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Page } from '../shared/page.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ListedMeeting } from './meeting-list.js';
import type { MeetingRepository } from './ports.js';

export interface ListMeetingsTx {
  meetings: Pick<MeetingRepository, 'listOf'>;
}

export type ListMeetings = (caller: ShipCaller, input?: MeetingsInput) => Promise<Result<Page<ListedMeeting, string>, never>>;

/** The caller must check the crew and messages:receive scope; the query enforces fleet and participant visibility. */
export function createListMeetings(deps: { uow: UnitOfWork<ListMeetingsTx> }): ListMeetings {
  return (caller, input) => deps.uow.run(async (tx) => ok(await tx.meetings.listOf(caller.fleetId, {
    shipId: caller.shipId, cursor: input?.cursor, limit: input?.limit ?? MEETINGS_PAGE_SIZE_DEFAULT,
  })));
}
