import type { MeetingId, MessageId, ShipId, ShipKind, ShipStatus } from '@aeolus-fleet/common';

import { shipStatus, type LeaseRepository, type ShipRepository } from '../registry/public.js';
import type { ShipCaller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Page, PageQuery } from '../shared/page.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
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

export interface MeetingRead {
  meetingId: MeetingId;
  title: string | null;
  owner: MeetingParty;
  moderator: MeetingParty;
  openedAt: Date;
  endedAt: Date | null;
  participants: MeetingParticipantRead[];
  contributions: Page<ContributionRead, MessageId>;
}

export type ReadMeeting = (caller: ShipCaller, input: { meetingId: MeetingId } & PageQuery<MessageId>) => Promise<Result<MeetingRead, DomainError<'MEETING_NOT_FOUND'>>>;

/**
 * Use case: a participant reads its meeting (`meeting`, decision 0061): its
 * owner and moderator, when it opened and ended, each participant with its
 * kind and status, crewed or awaiting crew, as it is now (M14), and a page of
 * what was said so far, newest first (M12): its contributions, never the
 * notices. A meeting that does not exist and one the caller takes no part in
 * are one refusal. Reads only.
 */
export function createReadMeeting(deps: { uow: UnitOfWork<ReadMeetingTx> }): ReadMeeting {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<MeetingRead, DomainError<'MEETING_NOT_FOUND'>>> => {
      const { fleetId } = caller;
      const { meetingId } = input;
      const meeting = await tx.meetings.find(fleetId, meetingId);
      if (!meeting?.participants.some((participant) => participant.shipId === caller.shipId)) {
        return refuse('MEETING_NOT_FOUND', `Meeting ${meetingId} does not exist or you are not one of its participants`);
      }
      const participants: MeetingParticipantRead[] = [];
      for (const { shipId } of meeting.participants) {
        const ship = await tx.ships.find(fleetId, shipId);
        if (ship) {
          const lease = await tx.leases.findOpenForShare(fleetId, shipId);
          participants.push({ id: ship.id, name: ship.name, kind: ship.kind, status: shipStatus(ship, { isCrewed: lease !== undefined }) });
        }
      }
      const names = new Map(participants.map((participant) => [participant.id, participant.name]));
      const party = async (shipId: ShipId): Promise<MeetingParty> => ({ id: shipId, name: names.get(shipId) ?? (await tx.ships.find(fleetId, shipId))?.name ?? shipId });
      const page = await tx.meetings.contributions(fleetId, { meetingId, cursor: input.cursor, limit: input.limit });
      const items: ContributionRead[] = [];
      for (const message of page.items) {
        items.push({ messageId: message.id, sender: await party(message.senderShipId), payload: message.payload, contentType: message.contentType, model: message.model, sentAt: message.createdAt });
      }
      return ok({
        meetingId,
        title: meeting.title,
        owner: await party(meeting.ownerShipId),
        moderator: await party(meeting.moderatorShipId),
        openedAt: meeting.openedAt,
        endedAt: meeting.endedAt,
        participants,
        contributions: { items, nextCursor: page.nextCursor },
      });
    });
}
