import type { IdGenerator, MeetingId } from '@aeolus-fleet/common';

import { checkReach, keepingReachRefusal, type CheckReachTx, type NotReachable } from '../registry/public.js';
import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent } from '../shared/events.js';
import type { Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { changeMeeting, type MeetingChange, type MeetingChangeRefusal } from './meeting-life.js';
import { withDataKeys, type DataKeysNeeded, type PayloadSealing } from './data-keys.js';
import { tellOfChange, type MeetingNoticeTx } from './meeting-notice.js';
import type { AcceptRefusal } from './message.js';
import type { MeetingRepository, RequestHasher } from './ports.js';

export interface ChangeMeetingTx extends MeetingNoticeTx, CheckReachTx {
  meetings: Pick<MeetingRepository, 'findForUpdate' | 'save'>;
}

export type ChangeMeetingFailure = MeetingChangeRefusal | NotReachable | AcceptRefusal | DomainError<'KEY_UNAVAILABLE'>;

export type ChangeMeeting = (caller: ShipCaller, input: { meetingId: MeetingId; change: MeetingChange }) => Promise<Result<undefined, ChangeMeetingFailure>>;

/**
 * A participant leaves or rejoins; a person also joins for the first time.
 * The owner revokes ships, transfers the meeting and names its moderator.
 * The owner, moderator or a present person ends it. Joining checks the
 * owner's reach, recording a refusal as a send does. Changes, notices and
 * events commit together under the meeting lock, with data keys held before
 * the transaction in a sealed fleet.
 */
export function createChangeMeeting(deps: { uow: UnitOfWork<ChangeMeetingTx>; clock: Clock; ids: IdGenerator; hasher: RequestHasher; sealing: PayloadSealing }): ChangeMeeting {
  return (caller, input) =>
    withDataKeys({ sealing: deps.sealing, fleetId: caller.fleetId }, (held) => keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, ChangeMeetingFailure | DataKeysNeeded>> => {
      const { fleetId } = caller;
      const at = deps.clock.now();
      const changed = changeMeeting(await tx.meetings.findForUpdate(fleetId, input.meetingId), { meetingId: input.meetingId, by: caller.shipId, byKind: caller.kind, change: input.change, at });
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
      return tellOfChange({ tx, ids: deps.ids, hasher: deps.hasher, held }, { meeting, micGivenTo, endedBy: hasEnded ? caller.shipId : null, at });
    }));
}
