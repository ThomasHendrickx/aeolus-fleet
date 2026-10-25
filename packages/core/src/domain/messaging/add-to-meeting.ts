import { MEETING_ADDED_CONTENT_TYPE, type IdGenerator, type LabelValueId, type MeetingId } from '@aeolus-fleet/common';

import { checkReach, keepingReachRefusal, resolveInvitees, type CheckReachTx, type Invitee, type NotReachable, type ResolveInviteesTx, type UnresolvableSelector } from '../registry/public.js';
import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { withinDailyMessageLimit, type DailyMessageLimitTx } from './daily-message-limit.js';
import type { PresenceRefusal } from './meeting.js';
import { addToMeeting } from './meeting-life.js';
import { addedNoticeOf, tellParticipant, type MeetingNoticeTx } from './meeting-notice.js';
import type { AcceptRefusal } from './message.js';
import type { MeetingRepository, RequestHasher } from './ports.js';

export interface AddToMeetingTx extends Omit<ResolveInviteesTx, 'ships'>, Omit<CheckReachTx, 'ships'>, Omit<DailyMessageLimitTx, 'messages'>, Omit<MeetingNoticeTx, 'messages'> {
  ships: ResolveInviteesTx['ships'] & CheckReachTx['ships'];
  messages: DailyMessageLimitTx['messages'] & MeetingNoticeTx['messages'];
  meetings: Pick<MeetingRepository, 'findForUpdate' | 'save'>;
}

export interface ShipsToAdd {
  meetingId: MeetingId;
  /** The ships added by id or by name. */
  ships?: readonly Invitee[];
  /** A label selection: the ships carrying every one of these values are added too. */
  valueIds?: readonly LabelValueId[];
  /** The exact model the owner's session runs, which its added notices state, as a send does. */
  model?: string;
}

export type AddToMeetingFailure =
  | PresenceRefusal
  | DomainError<'NOT_OWNER' | 'MEETING_WITHOUT_INVITEES' | 'MESSAGE_LIMIT_REACHED'>
  | UnresolvableSelector
  | NotReachable
  | AcceptRefusal;

export type AddToMeeting = (caller: ShipCaller, input: ShipsToAdd) => Promise<Result<undefined, AddToMeetingFailure>>;

/**
 * Use case: the owner adds ships to its open meeting later (decision 0061,
 * M5, M6, M13), named as an open names them. It must reach each ship it adds
 * by send, or nothing is added and the refusal is recorded. Each added ship
 * gets the added notice from the owner, from joining on its deliveries, and
 * the meeting so far to read. A ship present already stays as it is.
 */
export function createAddToMeeting(deps: { uow: UnitOfWork<AddToMeetingTx>; clock: Clock; ids: IdGenerator; hasher: RequestHasher }): AddToMeeting {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<undefined, AddToMeetingFailure>> => {
      const { fleetId } = caller;
      const at = deps.clock.now();
      const meeting = await tx.meetings.findForUpdate(fleetId, input.meetingId);
      const allowed = addToMeeting(meeting, { meetingId: input.meetingId, by: caller.shipId, shipIds: [], at });
      if (!allowed.isOk) {
        return allowed;
      }
      const ships = input.ships ?? [];
      const valueIds = input.valueIds ?? [];
      if (ships.length === 0 && valueIds.length === 0) {
        return refuse('MEETING_WITHOUT_INVITEES', 'Name the ships to add: by id, by name or by label');
      }
      const invited = await resolveInvitees(tx, { fleetId, ships, valueIds });
      if (!invited.isOk) {
        return invited;
      }
      const added = addToMeeting(meeting, { meetingId: input.meetingId, by: caller.shipId, shipIds: invited.value, at });
      if (!added.isOk) {
        return added;
      }
      for (const shipId of added.value.added) {
        const reach = await checkReach({ tx, ids: deps.ids }, { fleetId, senderShipId: caller.shipId, recipient: { kind: 'ship', shipId }, isAnswerToSender: false, at });
        if (!reach.isOk) {
          return reach;
        }
      }
      if (added.value.added.length === 0) {
        return ok(undefined);
      }
      const withinLimit = await withinDailyMessageLimit(tx, { fleetId, time: at, count: added.value.added.length });
      if (!withinLimit.isOk) {
        return withinLimit;
      }
      await tx.meetings.save(added.value.meeting);
      for (const event of added.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      const payload = JSON.stringify(await addedNoticeOf(tx, added.value.meeting));
      for (const shipId of added.value.added) {
        // The added notice (M11): from the owner, who reached the ship just now.
        const told = await tellParticipant(
          { tx, ids: deps.ids, hasher: deps.hasher },
          {
            meeting: added.value.meeting,
            senderShipId: caller.shipId,
            senderKind: caller.kind,
            ...(caller.signedInAccountId === undefined ? {} : { signedInAccountId: caller.signedInAccountId }),
            shipId,
            contentType: MEETING_ADDED_CONTENT_TYPE,
            payload,
            model: input.model,
            at,
          },
        );
        if (!told.isOk) {
          return told;
        }
      }
      return ok(undefined);
    });
}
