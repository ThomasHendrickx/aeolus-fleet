import type { IdGenerator, MeetingId } from '@aeolus-fleet/common';

import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent } from '../shared/events.js';
import type { Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { tellOfChange, type MeetingNoticeTx } from './meeting-notice.js';
import type { AcceptRefusal } from './message.js';
import { changeMic, type MicChange, type MicRefusal } from './mic.js';
import type { MeetingRepository, RequestHasher } from './ports.js';

export interface ChangeMicTx extends MeetingNoticeTx {
  meetings: Pick<MeetingRepository, 'findForUpdate' | 'save'>;
}

export type ChangeMicFailure = MicRefusal | AcceptRefusal;

export type ChangeMic = (caller: ShipCaller, input: { meetingId: MeetingId; change: MicChange }) => Promise<Result<undefined, ChangeMicFailure>>;

/**
 * Changes the mic of a meeting the caller takes part in (decision 0061, M7 to
 * M11), in one unit of work with its events. The meeting is held for update,
 * so mic changes take turns and a contribution in flight finishes first. The
 * ship that gets the mic is told by a message from the moderator, which states
 * no model: the change may be another ship's, as a release under first in line.
 */
export function createChangeMic(deps: { uow: UnitOfWork<ChangeMicTx>; clock: Clock; ids: IdGenerator; hasher: RequestHasher }): ChangeMic {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<undefined, ChangeMicFailure>> => {
      const { fleetId } = caller;
      const at = deps.clock.now();
      const changed = changeMic(await tx.meetings.findForUpdate(fleetId, input.meetingId), { meetingId: input.meetingId, by: caller.shipId, change: input.change, at });
      if (!changed.isOk) {
        return changed;
      }
      const { meeting, events, givenTo } = changed.value;
      await tx.meetings.save(meeting);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return tellOfChange({ tx, ids: deps.ids, hasher: deps.hasher }, { meeting, micGivenTo: givenTo, endedBy: null, at });
    });
}
