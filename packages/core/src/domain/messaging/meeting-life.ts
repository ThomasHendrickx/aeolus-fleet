import type { MeetingId, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type Actor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { checkPresent, isPresent, type Meeting, type Participant, type PresenceRefusal } from './meeting.js';
import { offTheMic } from './mic.js';

/**
 * A meeting's life after it opened (decision 0061, M2, M3, M13, M15, M17):
 * who takes part, who owns and moderates it, and its end. Each change keeps
 * the mic whole: a ship that goes out goes off the mic.
 */

/**
 * One change of a meeting: a participant leaves or rejoins by itself; the
 * owner revokes a ship's right, transfers the meeting or names its
 * moderator; the owner or the moderator ends it.
 */
export type MeetingChange =
  | { kind: 'leave' }
  | { kind: 'rejoin' }
  | { kind: 'revoke'; shipId: ShipId }
  | { kind: 'transfer'; shipId: ShipId }
  | { kind: 'nameModerator'; shipId: ShipId }
  | { kind: 'end' };

export type MeetingChangeRefusal =
  | PresenceRefusal
  | DomainError<'ALREADY_PRESENT' | 'OWNER_CANNOT_LEAVE' | 'NOT_OWNER' | 'NOT_OWNER_OR_MODERATOR' | 'PARTICIPANT_NOT_FOUND'>;

/** The meeting after a change, its events, the ship that got the mic by it, and whether it ended, to tell the others (M11). */
export interface MeetingChanged {
  meeting: Meeting;
  events: NewEvent[];
  micGivenTo: ShipId | null;
  hasEnded: boolean;
}

const ENDED = 'it no longer changes';

/**
 * Changes the meeting for the ship `by`. A rejoin takes a ship that left,
 * whose right stands; every other change takes a present participant of the
 * open meeting. The owner's reach for a rejoin is the caller's to check.
 */
export function changeMeeting(meeting: Meeting | undefined, input: { meetingId: MeetingId; by: ShipId; change: MeetingChange; at: Date }): Result<MeetingChanged, MeetingChangeRefusal> {
  const { meetingId, by, change, at } = input;
  if (change.kind === 'rejoin') {
    return rejoined(meeting, { meetingId, by, at });
  }
  const present = checkPresent(meeting, { meetingId, shipId: by, ended: ENDED });
  if (!present.isOk) {
    return present;
  }
  const open = present.value;
  const actor = shipActor(by);
  switch (change.kind) {
    case 'leave':
      return byOwnerNever(open, by) ?? ok(gone(open, { shipId: by, actor, at, type: 'ParticipantLeft', isRevoked: false }));
    case 'revoke':
      return (
        onlyByOwner(open, by) ??
        byOwnerNever(open, change.shipId) ??
        presentOnly(open, change.shipId) ??
        ok(gone(open, { shipId: change.shipId, actor, at, type: 'ParticipantRevoked', isRevoked: true }))
      );
    case 'transfer':
      return onlyByOwner(open, by) ?? presentOnly(open, change.shipId) ?? ok(roleChanged(open, { role: 'owner', shipId: change.shipId, actor, at }));
    case 'nameModerator':
      return onlyByOwner(open, by) ?? presentOnly(open, change.shipId) ?? ok(roleChanged(open, { role: 'moderator', shipId: change.shipId, actor, at }));
    case 'end':
      if (by !== open.ownerShipId && by !== open.moderatorShipId) {
        return refuse('NOT_OWNER_OR_MODERATOR', `Only the owner or the moderator of meeting ${open.id} ends it`);
      }
      return ok(ended(open, { by, actor, at }));
  }
}

/**
 * The ships added to the meeting by its owner (M5, M13): each ship not
 * present joins now, after those there, its right given back if the owner had
 * revoked it. A ship present already stays as it is. The owner's reach of each
 * added ship is the caller's to check.
 */
export function addToMeeting(
  meeting: Meeting | undefined,
  input: { meetingId: MeetingId; by: ShipId; shipIds: readonly ShipId[]; at: Date },
): Result<{ meeting: Meeting; events: NewEvent[]; added: ShipId[] }, PresenceRefusal | DomainError<'NOT_OWNER'>> {
  const { by, at } = input;
  const present = checkPresent(meeting, { meetingId: input.meetingId, shipId: by, ended: ENDED });
  if (!present.isOk) {
    return present;
  }
  const open = present.value;
  const notOwner = onlyByOwner(open, by);
  if (notOwner) {
    return notOwner;
  }
  const added = [...new Set(input.shipIds)].filter((shipId) => !isPresent(open, shipId));
  const joined = (shipId: ShipId): Participant => ({ shipId, joinedAt: at, leftAt: null, isRevoked: false });
  const participants = [...open.participants.filter(({ shipId }) => !added.includes(shipId)), ...added.map(joined)];
  return ok({
    meeting: { ...open, participants },
    events: added.map((shipId): NewEvent => ({ fleetId: open.fleetId, type: 'ParticipantAdded', occurredAt: at, actor: shipActor(by), shipId, details: { meetingId: open.id } })),
    added,
  });
}

/**
 * The meeting once the ship retired (M15, M17), caused by `actor`: a retired
 * owner ends it; a retired participant leaves it, its moderatorship going to
 * the owner. Undefined when the ship is not present in an open meeting.
 */
export function withRetiredShip(meeting: Meeting, input: { shipId: ShipId; actor: Actor; at: Date }): MeetingChanged | undefined {
  const { shipId, actor, at } = input;
  if (meeting.endedAt !== null || !isPresent(meeting, shipId)) {
    return undefined;
  }
  if (shipId === meeting.ownerShipId) {
    return ended(meeting, { by: shipId, actor, at });
  }
  return gone(meeting, { shipId, actor, at, type: 'ParticipantLeft', isRevoked: false });
}

function rejoined(meeting: Meeting | undefined, input: { meetingId: MeetingId; by: ShipId; at: Date }): Result<MeetingChanged, MeetingChangeRefusal> {
  const { by, at } = input;
  const left = checkPresent(meeting, { meetingId: input.meetingId, shipId: by, ended: ENDED });
  if (left.isOk) {
    return refuse('ALREADY_PRESENT', `You take part in meeting ${input.meetingId} already`);
  }
  if (left.error.kind !== 'PARTICIPANT_LEFT' || meeting === undefined) {
    return left;
  }
  const participants = meeting.participants.map((participant) => (participant.shipId === by ? { ...participant, joinedAt: at, leftAt: null } : participant));
  return ok({ meeting: { ...meeting, participants }, events: [lifeEvent(meeting, { type: 'ParticipantRejoined', shipId: by, actor: shipActor(by), at })], micGivenTo: null, hasEnded: false });
}

/** The ship out of the meeting, left or revoked: off the mic, its moderatorship to the owner. */
function gone(meeting: Meeting, input: { shipId: ShipId; actor: Actor; at: Date; type: 'ParticipantLeft' | 'ParticipantRevoked'; isRevoked: boolean }): MeetingChanged {
  const { shipId, actor, at } = input;
  const participants = meeting.participants.map((participant) => (participant.shipId === shipId ? { ...participant, leftAt: at, isRevoked: input.isRevoked } : participant));
  const events: NewEvent[] = [lifeEvent(meeting, { type: input.type, shipId, actor, at })];
  let changed: Meeting = { ...meeting, participants };
  if (shipId === meeting.moderatorShipId) {
    changed = { ...changed, moderatorShipId: meeting.ownerShipId };
    events.push(lifeEvent(meeting, { type: 'ModeratorNamed', shipId: meeting.ownerShipId, actor, at }));
  }
  const offMic = offTheMic(changed, { shipId, actor, at });
  return { meeting: offMic.meeting, events: [...events, ...offMic.events], micGivenTo: offMic.givenTo, hasEnded: false };
}

/** The owner or the moderator handed to another present participant; a new moderator goes off the mic, as it needs none. */
function roleChanged(meeting: Meeting, input: { role: 'owner' | 'moderator'; shipId: ShipId; actor: Actor; at: Date }): MeetingChanged {
  const { role, shipId, actor, at } = input;
  if ((role === 'owner' ? meeting.ownerShipId : meeting.moderatorShipId) === shipId) {
    return { meeting, events: [], micGivenTo: null, hasEnded: false };
  }
  if (role === 'owner') {
    return { meeting: { ...meeting, ownerShipId: shipId }, events: [lifeEvent(meeting, { type: 'OwnershipTransferred', shipId, actor, at })], micGivenTo: null, hasEnded: false };
  }
  const named = lifeEvent(meeting, { type: 'ModeratorNamed', shipId, actor, at });
  const offMic = offTheMic({ ...meeting, moderatorShipId: shipId }, { shipId, actor, at });
  return { meeting: offMic.meeting, events: [named, ...offMic.events], micGivenTo: offMic.givenTo, hasEnded: false };
}

function ended(meeting: Meeting, input: { by: ShipId; actor: Actor; at: Date }): MeetingChanged {
  return { meeting: { ...meeting, endedAt: input.at }, events: [lifeEvent(meeting, { type: 'MeetingEnded', shipId: input.by, actor: input.actor, at: input.at })], micGivenTo: null, hasEnded: true };
}

function lifeEvent(meeting: Meeting, input: { type: NewEvent['type']; shipId: ShipId; actor: Actor; at: Date }): NewEvent {
  return { fleetId: meeting.fleetId, type: input.type, occurredAt: input.at, actor: input.actor, shipId: input.shipId, details: { meetingId: meeting.id } };
}

function onlyByOwner(meeting: Meeting, by: ShipId): Result<never, DomainError<'NOT_OWNER'>> | undefined {
  return by === meeting.ownerShipId ? undefined : refuse('NOT_OWNER', `Only the owner of meeting ${meeting.id} adds and revokes ships, transfers it and names its moderator`);
}

function byOwnerNever(meeting: Meeting, shipId: ShipId): Result<never, DomainError<'OWNER_CANNOT_LEAVE'>> | undefined {
  return shipId === meeting.ownerShipId ? refuse('OWNER_CANNOT_LEAVE', `You own meeting ${meeting.id}: transfer it to another participant first`) : undefined;
}

function presentOnly(meeting: Meeting, shipId: ShipId): Result<never, DomainError<'PARTICIPANT_NOT_FOUND'>> | undefined {
  return isPresent(meeting, shipId) ? undefined : refuse('PARTICIPANT_NOT_FOUND', `Ship ${shipId} is not one of the participants of meeting ${meeting.id}`);
}
