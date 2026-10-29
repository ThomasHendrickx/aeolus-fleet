import type { MeetingId, MessageId, MicPattern, ParticipantState, ShipId, ShipKind, ShipStatus } from '@aeolus-fleet/common';

import { shipStatus, type LeaseRepository, type ShipRepository } from '../registry/public.js';
import type { ShipCaller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Page, PageQuery } from '../shared/page.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { unsealed, withDataKeys, type DataKeysNeeded, type PayloadSealing } from './data-keys.js';
import type { Participant } from './meeting.js';
import type { MeetingRepository } from './ports.js';

export interface ReadMeetingTx {
  meetings: Pick<MeetingRepository, 'find' | 'contributions'>;
  ships: Pick<ShipRepository, 'find'>;
  leases: Pick<LeaseRepository, 'findOpenForShare'>;
}

/** A ship of the meeting by id and name. */
export interface MeetingParty {
  id: ShipId;
  name: string;
}

/** A participant as the read shows it: who it is, and whether it is crewed now (M14). */
export interface MeetingParticipantRead extends MeetingParty {
  kind: ShipKind;
  status: ShipStatus;
  state: ParticipantState;
}

/** Whether a participant is in the meeting now, left it keeping its right, or was revoked (M13). */
function participantState(participant: Participant): ParticipantState {
  if (participant.isRevoked) {
    return 'revoked';
  }
  return participant.leftAt === null ? 'present' : 'left';
}

/** One contribution as the read shows it. */
export interface ContributionRead {
  messageId: MessageId;
  sender: MeetingParty;
  payload: string;
  contentType: string;
  model: string | null;
  sentAt: Date;
}

/** The mic as a participant reads it: who holds it, how it passes, and who waits for it, oldest first (M8, M9). */
export interface MicRead {
  holder: MeetingParty | null;
  pattern: MicPattern;
  requests: { ship: MeetingParty; requestedAt: Date }[];
}

export interface MeetingRead {
  meetingId: MeetingId;
  title: string | null;
  owner: MeetingParty;
  moderator: MeetingParty;
  openedAt: Date;
  endedAt: Date | null;
  participants: MeetingParticipantRead[];
  mic: MicRead;
  contributions: Page<ContributionRead, MessageId>;
}

export type ReadMeetingRefusal = DomainError<'MEETING_NOT_FOUND' | 'KEY_UNAVAILABLE'>;

export type ReadMeeting = (caller: ShipCaller, input: { meetingId: MeetingId } & PageQuery<MessageId>) => Promise<Result<MeetingRead, ReadMeetingRefusal>>;

/**
 * Use case: a participant reads its meeting (`meeting`, decision 0061): its
 * owner and moderator, when it opened and ended, each participant with its
 * kind and status, crewed or awaiting crew, as it is now (M14), its mic, and a page of
 * what was said so far, newest first (M12): its contributions, never the
 * notices. A meeting that does not exist and one the caller takes no part in
 * are one refusal. Reads only. In a sealed fleet each contribution is
 * unsealed with data keys unwrapped before the unit of work (decision 0068,
 * B9); a key it cannot get refuses KEY_UNAVAILABLE.
 */
export function createReadMeeting(deps: { uow: UnitOfWork<ReadMeetingTx>; sealing: PayloadSealing }): ReadMeeting {
  return (caller, input) =>
    withDataKeys({ sealing: deps.sealing, fleetId: caller.fleetId }, (keys) => deps.uow.run(async (tx): Promise<Result<MeetingRead, ReadMeetingRefusal | DataKeysNeeded>> => {
      const { fleetId } = caller;
      const { meetingId } = input;
      const meeting = await tx.meetings.find(fleetId, meetingId);
      // A former participant reads it too, whether it left or was revoked (M15).
      if (!meeting?.participants.some((participant) => participant.shipId === caller.shipId)) {
        return refuse('MEETING_NOT_FOUND', `Meeting ${meetingId} does not exist or you are not one of its participants`);
      }
      const participants: MeetingParticipantRead[] = [];
      for (const participant of meeting.participants) {
        const ship = await tx.ships.find(fleetId, participant.shipId);
        if (ship) {
          const lease = await tx.leases.findOpenForShare(fleetId, participant.shipId);
          participants.push({ id: ship.id, name: ship.name, kind: ship.kind, status: shipStatus(ship, { isCrewed: lease !== undefined }), state: participantState(participant) });
        }
      }
      const names = new Map(participants.map((participant) => [participant.id, participant.name]));
      const party = async (shipId: ShipId): Promise<MeetingParty> => ({ id: shipId, name: names.get(shipId) ?? (await tx.ships.find(fleetId, shipId))?.name ?? shipId });
      const page = await tx.meetings.contributions(fleetId, { meetingId, cursor: input.cursor, limit: input.limit });
      const items: ContributionRead[] = [];
      for (const message of page.items) {
        const payload = unsealed(keys, { row: { fleetId, rowId: message.id }, payload: message.payload });
        if (!payload.isOk) {
          return payload;
        }
        items.push({ messageId: message.id, sender: await party(message.senderShipId), payload: payload.value, contentType: message.contentType, model: message.model, sentAt: message.createdAt });
      }
      const requests: MicRead['requests'] = [];
      for (const request of meeting.micRequests) {
        requests.push({ ship: await party(request.shipId), requestedAt: request.requestedAt });
      }
      const mic: MicRead = { holder: meeting.micHolderShipId === null ? null : await party(meeting.micHolderShipId), pattern: meeting.micPattern, requests };
      return ok({
        meetingId,
        title: meeting.title,
        owner: await party(meeting.ownerShipId),
        moderator: await party(meeting.moderatorShipId),
        openedAt: meeting.openedAt,
        endedAt: meeting.endedAt,
        participants,
        mic,
        contributions: { items, nextCursor: page.nextCursor },
      });
    }));
}
