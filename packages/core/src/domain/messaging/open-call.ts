/** The moderator opens one durable call, snapshots its expected ships and tells every participant. */
import { MEETING_CALL_CONTENT_TYPE, type IdGenerator, type MeetingId, type MessageId, type ShipId } from '@aeolus-fleet/common';

import { isCrew, type ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent } from '../shared/events.js';
import { idempotencyKey } from '../shared/idempotency-key.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { closeCallWithin, type CallCloseTx } from './call-round.js';
import { withinDailyMessageLimit, type DailyMessageLimitTx } from './daily-message-limit.js';
import { sealedMessage, withDataKeys, type DataKeysNeeded, type PayloadSealing } from './data-keys.js';
import { sendRequestText } from './send-request.js';
import { openCall, type CallRefusal } from './meeting-call.js';
import { acceptContribution, type AcceptRefusal } from './message.js';
import type { MeetingRepository, MessageRepository, RequestHasher } from './ports.js';

export interface OpenCallTx extends CallCloseTx, DailyMessageLimitTx {
  messages: MessageRepository;
  meetings: MeetingRepository;
}
export interface CallToOpen {
  meetingId: MeetingId;
  question: string;
  excludedShipIds?: readonly ShipId[];
  deadline?: string;
  idempotencyKey: string;
  model?: string;
}
export type OpenCallRefusal = CallRefusal | AcceptRefusal | DomainError<'IDEMPOTENCY_KEY_REUSED' | 'INVALID_IDEMPOTENCY_KEY' | 'MESSAGE_LIMIT_REACHED' | 'KEY_UNAVAILABLE'>;
export type OpenCall = (caller: ShipCaller, input: CallToOpen) => Promise<Result<{ callId: MessageId }, OpenCallRefusal>>;

export function createOpenCall(deps: { uow: UnitOfWork<OpenCallTx>; clock: Clock; ids: IdGenerator; hasher: RequestHasher; sealing: PayloadSealing }): OpenCall {
  return async (caller, input) => {
    const key = idempotencyKey(input.idempotencyKey);
    if (!key.isOk) return key;
    const requestHash = deps.hasher.hash(JSON.stringify(['call', input.meetingId, input.question, input.excludedShipIds ?? [], input.deadline ?? null]));
    return withDataKeys({ sealing: deps.sealing, fleetId: caller.fleetId }, (held) => deps.uow.run(async (tx): Promise<Result<{ callId: MessageId }, OpenCallRefusal | DataKeysNeeded>> => {
      const senderKey = { fleetId: caller.fleetId, senderShipId: caller.shipId, idempotencyKey: key.value };
      await tx.messages.lockIdempotencyKey(senderKey);
      const original = await tx.messages.findByIdempotencyKey(senderKey);
      if (original !== undefined) {
        const call = await tx.meetings.findCall(caller.fleetId, { meetingId: input.meetingId, callId: original.id });
        return call?.requestHash === requestHash ? ok({ callId: original.id }) : refuse('IDEMPOTENCY_KEY_REUSED', 'This key was already used for another request');
      }
      const meeting = await tx.meetings.findForUpdate(caller.fleetId, input.meetingId);
      const previous = await tx.meetings.latestCall(caller.fleetId, input.meetingId);
      const at = deps.clock.now();
      const opened = openCall(meeting, { meetingId: input.meetingId, by: caller.shipId, requestHash, callId: deps.ids('message'), question: input.question, excludedShipIds: input.excludedShipIds ?? [], deadline: input.deadline === undefined ? undefined : new Date(input.deadline), previous, at });
      if (!opened.isOk) return opened;
      if (meeting === undefined) return refuse('MEETING_NOT_FOUND', 'The meeting does not exist');
      const withinLimit = await withinDailyMessageLimit(tx, { fleetId: caller.fleetId, time: at });
      if (!withinLimit.isOk) return withinLimit;
      const { call, events } = opened.value;
      const accepted = acceptContribution({ messageId: call.id, fleetId: caller.fleetId, senderShipId: caller.shipId, senderKind: caller.kind, senderLeaseId: isCrew(caller) ? caller.leaseId : null, meetingId: meeting.id, deliveries: meeting.participants.filter((p) => p.leftAt === null).map((p) => ({ deliveryId: deps.ids('delivery'), shipId: p.shipId })), payload: JSON.stringify({ meetingId: meeting.id, callId: call.id, goal: meeting.goal, question: input.question, expectedShipIds: call.expectedShipIds, deadline: call.deadline.toISOString() }), contentType: MEETING_CALL_CONTENT_TYPE, model: input.model, idempotencyKey: key.value, requestHash, ...(caller.signedInAccountId === undefined ? {} : { signedInAccountId: caller.signedInAccountId }), at });
      if (!accepted.isOk) return accepted;
      const message = await sealedMessage({ tx, held }, { message: accepted.value.message, sealedRequestHash: deps.hasher.hash(sendRequestText({ selector: accepted.value.message.selector, payload: undefined, contentType: MEETING_CALL_CONTENT_TYPE, inReplyTo: undefined, isForced: false })) });
      if (!message.isOk) return message;
      await tx.messages.create(message.value);
      await tx.meetings.createCall(call);
      for (const event of [...events, ...accepted.value.events]) await recordEvent({ events: tx.events, ids: deps.ids }, event);
      for (const delivery of accepted.value.deliveries) {
        await tx.deliveries.create(delivery, message.value);
        await tx.notifier.deliveryPending({ fleetId: caller.fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
      }
      const closed = await closeCallWithin({ tx, ids: deps.ids, hasher: deps.hasher, held }, { meeting, call, by: caller.shipId, at });
      return closed.isOk ? ok({ callId: call.id }) : closed;
    }));
  };
}
