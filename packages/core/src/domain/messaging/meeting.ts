import type { FleetId, MeetingId, MessageId, MicPattern, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { MicRequest } from './mic.js';

/**
 * One moderated conversation of ships (decision 0061): what a participant
 * contributes reaches every other participant. It has one owner and one
 * moderator, both participants, the ship that opened it at first.
 */
export interface Meeting {
  id: MeetingId;
  fleetId: FleetId;
  /** A short name a person reads when auditing later; none when it was opened without one. */
  title: string | null;
  ownerShipId: ShipId;
  moderatorShipId: ShipId;
  /** The ship that opened it, whose idempotency key it was opened with. */
  openedByShipId: ShipId;
  idempotencyKey: string;
  /** The hash of the request it was opened with: what a repeat of its key must match. */
  requestHash: string;
  /** Every ship in it, each once, the opener first, then in the order they joined. */
  participants: Participant[];
  openedAt: Date;
  /** When it ended; none while it is open. */
  endedAt: Date | null;
  /** The participant that holds the mic, which may contribute beside the moderator; none while the mic is free (M7). */
  micHolderShipId: ShipId | null;
  /** How a free mic passes (M9). */
  micPattern: MicPattern;
  /** The ships waiting for the mic, oldest first, each once (M8). */
  micRequests: MicRequest[];
}

/** A ship in a meeting, never a type, and when it joined. */
export interface Participant {
  shipId: ShipId;
  joinedAt: Date;
}

export type OpenMeetingRefusal = DomainError<'MEETING_WITHOUT_INVITEES'>;

/**
 * Opens a meeting of the opener and the ships it invited, resolved and each
 * reached by the opener already: the opener owns and moderates it. Each ship
 * joins once, the opener first; a meeting of the opener alone is refused.
 * MeetingOpened, then ParticipantAdded for each participant, caused by the
 * opener.
 */
export function openMeeting(input: {
  meetingId: MeetingId;
  fleetId: FleetId;
  title: string | null;
  openerShipId: ShipId;
  invitedShipIds: readonly ShipId[];
  idempotencyKey: string;
  requestHash: string;
  at: Date;
}): Result<{ meeting: Meeting; events: NewEvent[] }, OpenMeetingRefusal> {
  const { meetingId, fleetId, openerShipId, at } = input;
  const shipIds = [...new Set([openerShipId, ...input.invitedShipIds])];
  if (shipIds.length === 1) {
    return refuse('MEETING_WITHOUT_INVITEES', 'A meeting needs at least one ship besides its opener: invite ships by id, by name or by label');
  }
  const meeting: Meeting = {
    id: meetingId,
    fleetId,
    title: input.title,
    ownerShipId: openerShipId,
    moderatorShipId: openerShipId,
    openedByShipId: openerShipId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    participants: shipIds.map((shipId) => ({ shipId, joinedAt: at })),
    openedAt: at,
    endedAt: null,
    micHolderShipId: null,
    micPattern: 'moderator',
    micRequests: [],
  };
  const actor = shipActor(openerShipId);
  return ok({
    meeting,
    events: [
      { fleetId, type: 'MeetingOpened', occurredAt: at, actor, shipId: openerShipId, details: { meetingId, participants: shipIds.length } },
      ...shipIds.map((shipId): NewEvent => ({ fleetId, type: 'ParticipantAdded', occurredAt: at, actor, shipId, details: { meetingId } })),
    ],
  });
}

/**
 * An open with a key its opener used before: the same request is a repeat
 * and gets the original meeting; another request with that key is refused.
 */
export function repeatOfOpen(original: Meeting, requestHash: string): Result<MeetingId, DomainError<'IDEMPOTENCY_KEY_REUSED'>> {
  return original.requestHash === requestHash
    ? ok(original.id)
    : refuse('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for another meeting: open a new meeting with a new key');
}

export type ContributionRefusal = DomainError<'MEETING_NOT_FOUND' | 'MEETING_ENDED' | 'CONTRIBUTION_REPLIES' | 'CONTRIBUTION_FORCED' | 'MIC_NOT_HELD'>;

/**
 * Whether the ship may contribute to the meeting (decision 0061), and if so
 * the participants its contribution goes to: every one but itself. A meeting
 * that does not exist and one the ship is no participant of are one refusal,
 * so a stranger learns nothing of it; then an ended meeting; a contribution
 * replies to no message (M18) and is never forced; and only the moderator
 * and the mic's holder contribute (M7).
 */
export function checkContribution(
  meeting: Meeting | undefined,
  contribution: { meetingId: MeetingId; senderShipId: ShipId; inReplyTo: MessageId | undefined; isForced: boolean },
): Result<ShipId[], ContributionRefusal> {
  const { meetingId, senderShipId } = contribution;
  if (!meeting?.participants.some((participant) => participant.shipId === senderShipId)) {
    return refuse('MEETING_NOT_FOUND', `Meeting ${meetingId} does not exist or you are not one of its participants`);
  }
  if (meeting.endedAt !== null) {
    return refuse('MEETING_ENDED', `Meeting ${meetingId} ended: it takes no more contributions`);
  }
  if (contribution.inReplyTo !== undefined) {
    return refuse('CONTRIBUTION_REPLIES', 'A contribution replies to no message: send it to the meeting without inReplyTo');
  }
  if (contribution.isForced) {
    return refuse('CONTRIBUTION_FORCED', 'A contribution is never forced: send it to the meeting without isForced');
  }
  if (senderShipId !== meeting.moderatorShipId && senderShipId !== meeting.micHolderShipId) {
    return refuse('MIC_NOT_HELD', `You do not hold the mic of meeting ${meetingId}: request the mic, and contribute once it is given to you`);
  }
  return ok(participantsBut(meeting, senderShipId));
}

/** The participants but the one given, in the meeting's order. */
export function participantsBut(meeting: Meeting, shipId: ShipId): ShipId[] {
  return meeting.participants.filter((participant) => participant.shipId !== shipId).map((participant) => participant.shipId);
}
