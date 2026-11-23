/** A fixed list of ships asked once, changed under the meeting lock (decision 0061). */
import { MEETING_CALL_DEFAULT_MS, MEETING_CALL_MAX_BYTES, payloadBytes, type FleetId, type MeetingId, type MessageId, type ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { checkPresent, type Meeting, type PresenceRefusal } from './meeting.js';

export interface MeetingCall {
  id: MessageId;
  requestHash: string;
  fleetId: FleetId;
  meetingId: MeetingId;
  expectedShipIds: ShipId[];
  silentShipIds: ShipId[];
  deadline: Date;
  openedAt: Date;
  closedAt: Date | null;
  /** Derived from answer contributions; never stored on the call. */
  answers: { shipId: ShipId; messageId: MessageId; isLate?: boolean }[];
}
export type CallRefusal = PresenceRefusal | DomainError<'NOT_MODERATOR' | 'ALREADY_PRESENT' | 'INVALID_MEETING_END_TIME' | 'PAYLOAD_TOO_LARGE' | 'PARTICIPANT_NOT_FOUND' | 'MESSAGE_NOT_FOUND'>;

export function openCall(meeting: Meeting | undefined, input: { meetingId: MeetingId; by: ShipId; requestHash: string; callId: MessageId; question: string; excludedShipIds: readonly ShipId[]; awaitingCrewShipIds: readonly ShipId[]; deadline: Date | undefined; previous: MeetingCall | undefined; at: Date }): Result<{ call: MeetingCall; events: NewEvent[] }, CallRefusal> {
  const present = checkPresent(meeting, { meetingId: input.meetingId, shipId: input.by, ended: 'it takes no more calls', at: input.at });
  if (!present.isOk) return present;
  const held = present.value;
  if (held.moderatorShipId !== input.by) return refuse('NOT_MODERATOR', 'Only the moderator opens a call');
  if (input.previous?.closedAt === null) return refuse('ALREADY_PRESENT', 'A call is open already: finish it before opening another');
  if (payloadBytes(input.question) > MEETING_CALL_MAX_BYTES) return refuse('PAYLOAD_TOO_LARGE', 'A call question is at most 64 KB');
  const deadline = input.deadline ?? new Date(input.at.getTime() + MEETING_CALL_DEFAULT_MS);
  if (!Number.isFinite(deadline.getTime()) || deadline <= input.at || (held.endsAt !== null && deadline > held.endsAt)) return refuse('INVALID_MEETING_END_TIME', 'A call deadline is in the future and no later than the meeting end time');
  const call: MeetingCall = { id: input.callId, requestHash: input.requestHash, fleetId: held.fleetId, meetingId: held.id, expectedShipIds: held.participants.filter((p) => p.leftAt === null && !input.excludedShipIds.includes(p.shipId)).map((p) => p.shipId), silentShipIds: held.participants.filter((p) => p.leftAt === null && !input.excludedShipIds.includes(p.shipId) && input.awaitingCrewShipIds.includes(p.shipId)).map((p) => p.shipId), deadline, openedAt: input.at, closedAt: null, answers: [] };
  return ok({ call, events: [callEvent(call, { type: 'CallOpened', by: input.by, at: input.at })] });
}

export function answerCall(call: MeetingCall | undefined, input: { by: ShipId; messageId: MessageId; payload: string; at: Date }): Result<{ call: MeetingCall; events: NewEvent[] }, CallRefusal> {
  if (payloadBytes(input.payload) > MEETING_CALL_MAX_BYTES) return refuse('PAYLOAD_TOO_LARGE', 'A call answer is at most 64 KB');
  if (call === undefined) return refuse('MESSAGE_NOT_FOUND', 'The call does not exist in this meeting');
  if (!call.expectedShipIds.includes(input.by)) return refuse('PARTICIPANT_NOT_FOUND', 'This call does not expect an answer from you');
  if (call.answers.some((a) => a.shipId === input.by)) return refuse('ALREADY_PRESENT', 'Your answer to this call is stored already');
  return ok({ call: { ...call, answers: [...call.answers, { shipId: input.by, messageId: input.messageId, isLate: call.closedAt !== null || call.silentShipIds.includes(input.by) || input.at >= call.deadline }] }, events: [callEvent(call, { type: 'CallAnswered', by: input.by, at: input.at, messageId: input.messageId })] });
}

/** Silence settles an expected ship just as an on-time answer does. */
export function closeAnsweredCall(call: MeetingCall, input: { by: ShipId; at: Date }): { call: MeetingCall; events: NewEvent[] } {
  if (call.closedAt !== null) return { call, events: [] };
  const answered = call.answers.filter((answer) => !answer.isLate).map((answer) => answer.shipId);
  const silentShipIds = input.at >= call.deadline ? call.expectedShipIds.filter((shipId) => !answered.includes(shipId)) : call.silentShipIds;
  if (!call.expectedShipIds.every((shipId) => answered.includes(shipId) || silentShipIds.includes(shipId))) return { call, events: [] };
  return { call: { ...call, silentShipIds, closedAt: input.at }, events: [callEvent(call, { type: 'CallClosed', ...input })] };
}
function callEvent(call: MeetingCall, input: { type: NewEvent['type']; by: ShipId; at: Date; messageId?: MessageId }): NewEvent {
  return { fleetId: call.fleetId, type: input.type, occurredAt: input.at, actor: shipActor(input.by), shipId: input.by, messageId: input.messageId ?? call.id, details: { meetingId: call.meetingId, callId: call.id } };
}
