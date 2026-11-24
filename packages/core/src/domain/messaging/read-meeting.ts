import { MEETINGS_PAGE_SIZE_DEFAULT, meetingCallSchema } from '@aeolus-fleet/common';
import type { LeaseId, MeetingId, MessageId, MicPattern, ParticipantState, ShipId, ShipKind, ShipStatus } from '@aeolus-fleet/common';

import { canReachShip, shipStatus, type CheckReachTx, type LeaseRepository, type ShipRepository } from '../registry/public.js';
import type { ShipCaller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Page, PageQuery } from '../shared/page.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { listedUnsealed, unsealed, withDataKeysForList, type DataKeysNeeded, type ListedPayload, type PayloadSealing } from './data-keys.js';
import { readCallProgress, type CallProgressRead } from './read-call-progress.js';
import { readCall, type CallRead } from './call-round.js';
import type { MessageRepository } from './ports.js';
import type { Participant } from './meeting.js';
import type { MeetingRepository } from './ports.js';

export interface ReadMeetingTx extends Omit<CheckReachTx, 'reachRefusals'> {
  meetings: Pick<MeetingRepository, 'find' | 'contributions' | 'latestCall' | 'findCall' | 'progressPage' | 'closedCallCount' | 'callNumber'>;
  messages: Pick<MessageRepository, 'findMany'>;
  ships: Pick<ShipRepository, 'find' | 'findMany' | 'listActiveOfType'>;
  leases: Pick<LeaseRepository, 'readCrews'>;
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
  callId: MessageId | null;
  isLate: boolean;
  messageId: MessageId;
  sender: MeetingParty;
  senderLeaseId: LeaseId | null;
  /** Plain, or marked unreadable when its data key cannot be had (decision 0068, B9). */
  payload: ListedPayload;
  contentType: string;
  model: string | null;
  sentAt: Date;
}

/** The mic as a participant reads it: who holds it, how it passes, and who waits for it, oldest first (M8, M9). */
export interface MicRead {
  holder: MeetingParty | null;
  pattern: MicPattern;
  requests: { ship: MeetingParty; requestedAt: Date; words?: { payload: ListedPayload; contentType: string; model: string | null; senderLeaseId: LeaseId | null } }[];
}

export interface MeetingRead {
  endAfterCalls: number | null;
  closedCalls: number;
  call: (CallRead & { question: string; number: number; progress: Page<CallProgressRead, ShipId> }) | null;
  meetingId: MeetingId;
  title: string | null;
  goal: string | null;
  endsAt: Date | null;
  owner: MeetingParty;
  moderator: MeetingParty;
  openedAt: Date;
  endedAt: Date | null;
  participants: MeetingParticipantRead[];
  mic: MicRead;
  contributions: Page<ContributionRead, MessageId>;
}

export type ReadMeetingRefusal = DomainError<'MEETING_NOT_FOUND' | 'MESSAGE_NOT_FOUND' | 'KEY_UNAVAILABLE'>;

export type ReadMeeting = (caller: ShipCaller, input: { meetingId: MeetingId; callId?: MessageId; progressCursor?: ShipId; progressLimit?: number } & PageQuery<MessageId>) => Promise<Result<MeetingRead, ReadMeetingRefusal>>;

/**
 * Use case: a participant or a person reached by its owner reads a meeting (`meeting`, decision 0061): its
 * owner and moderator, when it opened and ended, each participant with its
 * kind and status, crewed or awaiting crew, as it is now (M14), its mic, and a page of
 * what was said so far, newest first (M12): its contributions, never the
 * notices. A meeting that does not exist and one the caller cannot read
 * are one refusal. Reads only. In a sealed fleet each contribution is
 * unsealed with data keys unwrapped before the unit of work (decision 0068,
 * B9); one whose key cannot be had is marked unreadable and the rest listed.
 */
export function createReadMeeting(deps: { uow: UnitOfWork<ReadMeetingTx>; sealing: PayloadSealing }): ReadMeeting {
  return (caller, input) =>
    withDataKeysForList({ sealing: deps.sealing, fleetId: caller.fleetId }, (keys) => deps.uow.run(async (tx): Promise<Result<MeetingRead, ReadMeetingRefusal | DataKeysNeeded>> => {
      const { fleetId } = caller;
      const { meetingId } = input;
      const meeting = await tx.meetings.find(fleetId, meetingId);
      // A former participant reads it too, whether it left or was revoked (M15).
      if (!meeting) return refuse('MEETING_NOT_FOUND', `Meeting ${meetingId} does not exist or you are not one of its participants`);
      if (!meeting.participants.some((participant) => participant.shipId === caller.shipId)) {
        if (caller.kind !== 'person') return refuse('MEETING_NOT_FOUND', `Meeting ${meetingId} does not exist or you are not one of its participants`);
        const isReached = await canReachShip(tx, { fleetId, senderShipId: meeting.ownerShipId, recipientShipId: caller.shipId });
        if (!isReached) return refuse('MEETING_NOT_FOUND', `Meeting ${meetingId} does not exist or you are not one of its participants`);
      }
      const participantIds = meeting.participants.map((participant) => participant.shipId);
      const [participantShips, participantCrews] = await Promise.all([tx.ships.findMany(fleetId, participantIds), tx.leases.readCrews(fleetId, participantIds)]);
      const shipsById = new Map(participantShips.map((ship) => [ship.id, ship]));
      const crewedIds = new Set(participantCrews.map((crew) => crew.shipId));
      const participants: MeetingParticipantRead[] = [];
      for (const participant of meeting.participants) {
        const ship = shipsById.get(participant.shipId);
        if (ship) {
          participants.push({ id: ship.id, name: ship.name, kind: ship.kind, status: shipStatus(ship, { isCrewed: crewedIds.has(ship.id) }), state: participantState(participant) });
        }
      }
      const names = new Map(participants.map((participant) => [participant.id, participant.name]));
      const party = async (shipId: ShipId): Promise<MeetingParty> => ({ id: shipId, name: names.get(shipId) ?? (await tx.ships.find(fleetId, shipId))?.name ?? shipId });
      const page = await tx.meetings.contributions(fleetId, { meetingId, cursor: input.cursor, limit: input.limit });
      const items: ContributionRead[] = [];
      for (const message of page.items) {
        const payload = listedUnsealed(keys, { row: { fleetId, rowId: message.id }, payload: message.payload });
        if (!payload.isOk) {
          return payload;
        }
        items.push({ isLate: message.isLate ?? false, callId: message.callId ?? null, messageId: message.id, sender: await party(message.senderShipId), senderLeaseId: message.senderLeaseId, payload: payload.value, contentType: message.contentType, model: message.model, sentAt: message.createdAt });
      }
      const requests: MicRead['requests'] = [];
      for (const request of meeting.micRequests) {
        if (request.words === undefined) {
          requests.push({ ship: await party(request.shipId), requestedAt: request.requestedAt });
        } else {
          const words = request.words;
          const payload = listedUnsealed(keys, { row: { fleetId, rowId: words.messageId }, payload: words.payload });
          if (!payload.isOk) return payload;
          requests.push({ ship: await party(request.shipId), requestedAt: request.requestedAt, words: { payload: payload.value, contentType: words.contentType, model: words.model ?? null, senderLeaseId: words.senderLeaseId } });
        }
      }
      const mic: MicRead = { holder: meeting.micHolderShipId === null ? null : await party(meeting.micHolderShipId), pattern: meeting.micPattern, requests };
      const latest = input.callId === undefined ? await tx.meetings.latestCall(fleetId, meetingId) : await tx.meetings.findCall(fleetId, { meetingId, callId: input.callId });
      if (input.callId !== undefined && latest === undefined) return refuse('MESSAGE_NOT_FOUND', 'The call does not exist in this meeting');
      const call = latest === undefined ? ok(null) : await readCall({ tx, held: keys }, latest);
      if (!call.isOk) return call;
      let question = '';
      if (latest !== undefined) {
        // The opening contribution is looked up by id, independently of the contribution page.
        const [message] = await tx.messages.findMany(fleetId, [latest.id]);
        if (message === undefined) return refuse('MESSAGE_NOT_FOUND', 'The call contribution is no longer retained');
        const payload = unsealed(keys, { row: { fleetId, rowId: message.id }, payload: message.payload });
        if (!payload.isOk) return payload;
        question = meetingCallSchema.parse(JSON.parse(payload.value)).question;
      }
      return ok({
        closedCalls: await tx.meetings.closedCallCount(fleetId, meetingId),
        endAfterCalls: meeting.endAfterCalls ?? null,
        call: call.value === null || latest === undefined ? null : { ...call.value, question, number: await tx.meetings.callNumber(fleetId, { meetingId, callId: latest.id }), progress: await readCallProgress(tx, { call: latest, cursor: input.progressCursor, limit: input.progressLimit ?? MEETINGS_PAGE_SIZE_DEFAULT }) },
        meetingId,
        title: meeting.title,
        goal: meeting.goal,
        endsAt: meeting.endsAt,
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
