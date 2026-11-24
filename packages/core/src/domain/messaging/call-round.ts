/** Collects a round from stored messages, and writes its close notice in the same transaction. */
import { PAYLOAD_MAX_BYTES, payloadBytes, MEETING_ROUND_CONTENT_TYPE, type MeetingRound, type IdGenerator, type ShipId } from '@aeolus-fleet/common';

import { recordEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import { listedUnsealed, unsealed, type DataKeysNeeded, type HeldDataKeys } from './data-keys.js';
import type { DomainError } from '../shared/errors.js';
import type { Meeting } from './meeting.js';
import { closeAnsweredCall, type MeetingCall } from './meeting-call.js';
import { endAfterCalls } from './meeting-life.js';
import { tellOfChange, tellParticipant, type MeetingNoticeTx } from './meeting-notice.js';
import type { AcceptRefusal } from './message.js';
import type { MeetingRepository, MessageRepository, RequestHasher } from './ports.js';
import type { ShipRepository } from '../registry/public.js';
import type { ContributionRead } from './read-meeting.js';

export interface CallReadTx {
  messages: Pick<MessageRepository, 'findMany'>;
  ships: Pick<ShipRepository, 'findMany'>;
}
export interface CallRead {
  callId: MeetingCall['id'];
  expectedShipIds: ShipId[];
  silentShipIds: ShipId[];
  notAskedShipIds: ShipId[];
  lateAnswers: ContributionRead[];
  deadline: Date;
  openedAt: Date;
  closedAt: Date | null;
  answers: ContributionRead[];
}
/** Read every answer of one call, bounded by its opening participant snapshot. */
export async function readCall(deps: { tx: CallReadTx; held: HeldDataKeys }, call: MeetingCall): Promise<Result<CallRead, DataKeysNeeded>> {
  const { tx, held } = deps;
  const rows = await answerRows(tx, call);
  const answers: ContributionRead[] = [];
  for (const answer of call.answers) {
    const message = rows.messages.get(answer.messageId);
    if (message === undefined) continue;
    const payload = listedUnsealed(held, { row: { fleetId: call.fleetId, rowId: message.id }, payload: message.payload });
    if (!payload.isOk) return payload;
    const ship = rows.ships.get(answer.shipId);
    answers.push({ isLate: answer.isLate ?? false, callId: call.id, messageId: message.id, sender: { id: answer.shipId, name: ship?.name ?? answer.shipId }, senderLeaseId: message.senderLeaseId, payload: payload.value, contentType: message.contentType, model: message.model, sentAt: message.createdAt });
  }
  return ok({ callId: call.id, expectedShipIds: call.expectedShipIds, silentShipIds: call.silentShipIds, notAskedShipIds: call.notAskedShipIds, lateAnswers: answers.filter((answer) => answer.isLate), deadline: call.deadline, openedAt: call.openedAt, closedAt: call.closedAt, answers: answers.filter((answer) => !answer.isLate) });
}
export interface CallCloseTx extends MeetingNoticeTx, CallReadTx {
  messages: MessageRepository;
  meetings: Pick<MeetingRepository, 'saveCall' | 'closedCallCount' | 'save' | 'contributed'>;
}
/** One closed call owes one collected result, and may reach the meeting's end condition. */
export async function closeCallWithin(deps: { tx: CallCloseTx; ids: IdGenerator; hasher: RequestHasher; held: HeldDataKeys }, input: { meeting: Meeting; call: MeetingCall; by: ShipId; at: Date; isInterrupted?: boolean }): Promise<Result<{ isMeetingEnded: boolean }, AcceptRefusal | DataKeysNeeded | DomainError<'KEY_UNAVAILABLE'>>> {
  const { tx, ids } = deps;
  const closed = closeAnsweredCall(input.call, { by: input.by, at: input.at, isInterrupted: input.isInterrupted });
  await tx.meetings.saveCall(closed.call);
  for (const event of closed.events) await recordEvent({ events: tx.events, ids }, event);
  if (closed.events.length === 0) return ok({ isMeetingEnded: false });
  const { meeting, at } = input;
  const rows = await answerRows(tx, closed.call);
  const answers = [];
  for (const answer of closed.call.answers.filter((answer) => !answer.isLate)) {
    const message = rows.messages.get(answer.messageId);
    if (message === undefined) continue;
    const payload = unsealed(deps.held, { row: { fleetId: meeting.fleetId, rowId: message.id }, payload: message.payload });
    if (!payload.isOk) return payload;
    const ship = rows.ships.get(answer.shipId);
    answers.push({ isLate: answer.isLate ?? false, callId: closed.call.id, senderLeaseId: message.senderLeaseId, isPayloadUnreadable: false, messageId: message.id, sender: { id: answer.shipId, name: ship?.name ?? answer.shipId }, payload: payload.value, contentType: message.contentType, model: message.model, sentAt: message.createdAt.toISOString() });
  }
  const envelope = { meetingId: meeting.id, goal: meeting.goal, callId: closed.call.id, expectedShipIds: closed.call.expectedShipIds, silentShipIds: closed.call.silentShipIds, notAskedShipIds: closed.call.notAskedShipIds, openedAt: closed.call.openedAt.toISOString(), deadline: closed.call.deadline.toISOString(), closedAt: at.toISOString() };
  const payload = roundNoticePayload({ ...envelope, isRoundReference: false, answers });
  const notice = await tellParticipant(deps, { meeting, senderShipId: meeting.moderatorShipId, shipId: meeting.moderatorShipId, contentType: MEETING_ROUND_CONTENT_TYPE, payload, model: undefined, at });
  if (!notice.isOk) return notice;
  const closedCallCount = await tx.meetings.closedCallCount(meeting.fleetId, meeting.id);
  const ended = endAfterCalls(meeting, { closedCallCount, at });
  if (ended === undefined) return ok({ isMeetingEnded: false });
  await tx.meetings.save(ended.meeting);
  for (const event of ended.events) await recordEvent({ events: tx.events, ids }, event);
  const told = await tellOfChange(deps, { meeting: ended.meeting, micGivenTo: null, endedBy: meeting.moderatorShipId, at });
  return told.isOk ? ok({ isMeetingEnded: true }) : told;
}


async function answerRows(tx: CallReadTx, call: MeetingCall) {
  const [messages, ships] = await Promise.all([
    tx.messages.findMany(call.fleetId, call.answers.map((answer) => answer.messageId)),
    tx.ships.findMany(call.fleetId, call.answers.map((answer) => answer.shipId)),
  ]);
  return { messages: new Map(messages.map((message) => [message.id, message])), ships: new Map(ships.map((ship) => [ship.id, ship])) };
}


/** Bound serialization itself: a large round must never require a giant JSON string just to choose its reference. */
function roundNoticePayload(round: Extract<MeetingRound, { isRoundReference: false }>): string {
  const reference = JSON.stringify({ meetingId: round.meetingId, callId: round.callId, isRoundReference: true, expectedCount: round.expectedShipIds.length, answeredCount: round.answers.length });
  const { answers, ...envelope } = round;
  let bytes = payloadBytes(JSON.stringify({ ...envelope, answers: [] }));
  if (bytes > PAYLOAD_MAX_BYTES) return reference;
  for (const [index, answer] of answers.entries()) {
    bytes += payloadBytes(JSON.stringify(answer)) + (index === 0 ? 0 : 1);
    if (bytes > PAYLOAD_MAX_BYTES) return reference;
  }
  return JSON.stringify(round);
}
