import type { IdGenerator, MeetingId } from '@aeolus-fleet/common';

import { checkReach, keepingReachRefusal, type CheckReachTx, type NotReachable } from '../registry/public.js';
import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent } from '../shared/events.js';
import type { Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { changeMeeting, type MeetingChange, type MeetingChangeRefusal } from './meeting-life.js';
import { tellOfChange, type MeetingNoticeTx } from './meeting-notice.js';
import type { AcceptRefusal } from './message.js';
import type { MeetingRepository, RequestHasher } from './ports.js';

export interface ChangeMeetingTx extends MeetingNoticeTx, CheckReachTx {
  meetings: Pick<MeetingRepository, 'findForUpdate' | 'save'>;
}

export type ChangeMeetingFailure = MeetingChangeRefusal | NotReachable | AcceptRefusal;

export type ChangeMeeting = (caller: ShipCaller, input: { meetingId: MeetingId; change: MeetingChange }) => Promise<Result<undefined, ChangeMeetingFailure>>;

/**
 * Changes a meeting the caller takes part in (decision 0061): it leaves or
 * rejoins, or, as its owner, revokes a ship, transfers the meeting or names
 * its moderator, or, as its owner or moderator, ends it. A rejoin is checked
 * on the owner's reach of the ship, as when it was added (M5), a refusal
 * recorded. One unit of work with its events and notices, the meeting held
 * for update.
 */
export function createChangeMeeting(deps: { uow: UnitOfWork<ChangeMeetingTx>; clock: Clock; ids: IdGenerator; hasher: RequestHasher }): ChangeMeeting {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, ChangeMeetingFailure>> => {
      const { fleetId } = caller;
      const at = deps.clock.now();
      const changed = changeMeeting(await tx.meetings.findForUpdate(fleetId, input.meetingId), { meetingId: input.meetingId, by: caller.shipId, change: input.change, at });
      if (!changed.isOk) {
        return changed;
      }
      const { meeting, events, micGivenTo, hasEnded } = changed.value;
      if (input.change.kind === 'rejoin') {
        const reach = await checkReach({ tx, ids: deps.ids }, { fleetId, senderShipId: meeting.ownerShipId, recipient: { kind: 'ship', shipId: caller.shipId }, isAnswerToSender: false, at });
        if (!reach.isOk) {
          return reach;
        }
      }
      await tx.meetings.save(meeting);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return tellOfChange({ tx, ids: deps.ids, hasher: deps.hasher }, { meeting, micGivenTo, endedBy: hasEnded ? caller.shipId : null, at });
    });
}
