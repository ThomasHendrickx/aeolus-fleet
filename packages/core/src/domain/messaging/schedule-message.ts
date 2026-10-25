import { isPingContentType, PING_CONTENT_TYPE, type IdGenerator, type MessageId, type MissedStrategy, type RefusalStrategy, type ScheduleId } from '@aeolus-fleet/common';

import { checkReach, keepingReachRefusal, resolveSelector, type CheckReachTx, type NotReachable, type ResolveSelectorTx, type UnresolvableSelector } from '../registry/public.js';
import { hasScope, type ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { idempotencyKey } from '../shared/idempotency-key.js';
import { ok, type Result } from '../shared/result.js';
import type { RecipientSelector } from '../shared/selector.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { isAnswerToSender } from './answer.js';
import { contentType } from './content-type.js';
import { checkModel, type AcceptRefusal } from './message.js';
import { payload } from './payload.js';
import type { DeliveryRepository, MessageRepository, RequestHasher, ScheduleNotifier, ScheduleRepository } from './ports.js';
import { GRACE_DEFAULT, MISSED_STRATEGY_DEFAULT, planSchedule, RETRY_WINDOW_DEFAULT, TIME_ZONE_DEFAULT, type ScheduledSend, type ScheduleRefusal, type ScheduleTimingInput } from './schedule.js';
import { withinScheduleLimits, type ScheduleLimitRefusal, type ScheduleLimitsTx } from './schedule-limits.js';
import { sendRequestText } from './send-request.js';

export interface ScheduleMessageTx extends Omit<ResolveSelectorTx, 'ships'>, Omit<CheckReachTx, 'ships'>, Omit<ScheduleLimitsTx, 'schedules'> {
  ships: ResolveSelectorTx['ships'] & CheckReachTx['ships'];
  messages: Pick<MessageRepository, 'find'>;
  deliveries: Pick<DeliveryRepository, 'findOfMessageReaching'>;
  schedules: ScheduleRepository;
  scheduleNotifier: ScheduleNotifier;
  events: EventLog;
}

/** What a ship schedules: a whole send input, its timing, what a refused send time does, and its key. */
export interface MessageToSchedule {
  selector: RecipientSelector;
  payload: string;
  /** text/plain when the creator gives none. */
  contentType?: string;
  model?: string;
  idempotencyKey: string;
  inReplyTo?: MessageId;
  isForced?: boolean;
  timing: ScheduleTimingInput;
  /** skip when the creator gives none. */
  onRefused?: RefusalStrategy;
  /** PT1H when the creator gives none. */
  retryWindow?: string;
  /** each when the creator gives none. */
  onMissed?: MissedStrategy;
  /** PT5M when the creator gives none. */
  grace?: string;
}

export type ScheduleMessageRefusal =
  | DomainError<'PAYLOAD_TOO_LARGE' | 'INVALID_CONTENT_TYPE' | 'INVALID_IDEMPOTENCY_KEY' | 'RESERVED_CONTENT_TYPE' | 'FORCE_NOT_ALLOWED' | 'IDEMPOTENCY_KEY_REUSED' | 'IN_REPLY_TO_NOT_FOUND'>
  | AcceptRefusal
  | ScheduleRefusal
  | ScheduleLimitRefusal
  | UnresolvableSelector
  | NotReachable;

export type ScheduleMessage = (caller: ShipCaller, input: MessageToSchedule) => Promise<Result<{ scheduleId: ScheduleId }, ScheduleMessageRefusal>>;

/**
 * Use case: the calling ship schedules a message (`schedule`, decision 0062):
 * core sends it as this ship at its time. Its send input is checked as a send
 * checks it, before any unit of work: the payload, the content type, the
 * model rule, and messages:force for a forced one (messages:send is checked
 * before this runs). The ship's key is checked first in the unit of work, so
 * a retry answers the same schedule; the key with another request is
 * refused. Then the timing: it gives a send time after now (S1), and the
 * fleet's minimum interval and schedules per ship limit take it (S12). The selector
 * resolves now and the creator must reach it by send now (S5), or the
 * refusal is recorded and nothing else is stored. A reply names a message of
 * the fleet. The schedule, ScheduleCreated and the notice that tells every
 * server's timer when it is due are one unit of work.
 */
export function createScheduleMessage(deps: { uow: UnitOfWork<ScheduleMessageTx>; clock: Clock; ids: IdGenerator; hasher: RequestHasher }): ScheduleMessage {
  return async (caller, input) => {
    const checked = checkedSchedule({ caller, input, hasher: deps.hasher });
    if (!checked.isOk) {
      return checked;
    }
    const { send, key, requestHash } = checked.value;
    return keepingReachRefusal(deps.uow, async (tx): Promise<Result<{ scheduleId: ScheduleId }, ScheduleMessageRefusal>> => {
      const { fleetId, shipId } = caller;
      const creatorKey = { fleetId, shipId, idempotencyKey: key };
      await tx.schedules.lockCreatorKey(creatorKey);
      const original = await tx.schedules.findByCreatorKey(creatorKey);
      if (original) {
        return original.requestHash === requestHash
          ? ok({ scheduleId: original.id })
          : refuse('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for another schedule: make a new schedule with a new key');
      }
      const at = deps.clock.now();
      const planned = planSchedule({
        scheduleId: deps.ids('schedule'),
        fleetId,
        shipId,
        send,
        timing: input.timing,
        onRefused: input.onRefused,
        retryWindow: input.retryWindow,
        onMissed: input.onMissed,
        grace: input.grace,
        idempotencyKey: key,
        requestHash,
        at,
      });
      if (!planned.isOk) {
        return planned;
      }
      const withinLimits = await withinScheduleLimits(tx, { fleetId, shipId, timing: planned.value.schedule.timing, at });
      if (!withinLimits.isOk) {
        return withinLimits;
      }
      const recipient = await resolveSelector(tx, { fleetId, selector: send.selector });
      if (!recipient.isOk) {
        return recipient;
      }
      const repliedTo = send.inReplyTo === null ? undefined : await tx.messages.find(fleetId, send.inReplyTo);
      if (send.inReplyTo !== null && !repliedTo) {
        return refuse('IN_REPLY_TO_NOT_FOUND', `Message ${send.inReplyTo} is not in the fleet: it was never sent, or it is no longer kept`);
      }
      const repliedDelivery = repliedTo && (await tx.deliveries.findOfMessageReaching(fleetId, { messageId: repliedTo.id, shipId }));
      const reach = await checkReach(
        { tx, ids: deps.ids },
        {
          fleetId,
          senderShipId: shipId,
          recipient: recipient.value,
          isAnswerToSender: isAnswerToSender({ senderShipId: shipId, recipient: recipient.value }, repliedTo && repliedDelivery && { message: repliedTo, delivery: repliedDelivery }),
          at,
        },
      );
      if (!reach.isOk) {
        return reach;
      }
      const { schedule, events } = planned.value;
      await tx.schedules.create(schedule);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      if (schedule.nextAttemptAt !== null) {
        await tx.scheduleNotifier.scheduleDue({ fleetId, scheduleId: schedule.id, attemptAt: schedule.nextAttemptAt });
      }
      return ok({ scheduleId: schedule.id });
    });
  };
}

/** The send input as a send checks it, the key, and the hash of the whole request: what a repeat of the key must ask for too. */
function checkedSchedule({ caller, input, hasher }: { caller: ShipCaller; input: MessageToSchedule; hasher: RequestHasher }): Result<{ send: ScheduledSend; key: string; requestHash: string }, ScheduleMessageRefusal> {
  if (input.contentType !== undefined && isPingContentType(input.contentType)) {
    return refuse('RESERVED_CONTENT_TYPE', `${PING_CONTENT_TYPE} is reserved for pings: ping a ship from the console`);
  }
  const isForced = input.isForced === true;
  if (isForced && !hasScope(caller, 'messages:force')) {
    return refuse('FORCE_NOT_ALLOWED', 'A forced schedule needs the messages:force scope');
  }
  const text = payload(input.payload);
  if (!text.isOk) {
    return text;
  }
  const mediaType = contentType(input.contentType);
  if (!mediaType.isOk) {
    return mediaType;
  }
  const key = idempotencyKey(input.idempotencyKey);
  if (!key.isOk) {
    return key;
  }
  const stated = checkModel({ contentType: mediaType.value, senderKind: caller.kind, model: input.model });
  if (!stated.isOk) {
    return stated;
  }
  const send: ScheduledSend = { selector: input.selector, payload: text.value, contentType: mediaType.value, model: input.model ?? null, inReplyTo: input.inReplyTo ?? null, isForced };
  const requestHash = hasher.hash(
    JSON.stringify([
      sendRequestText({ selector: send.selector, payload: send.payload, contentType: send.contentType, inReplyTo: input.inReplyTo, isForced }),
      ...timingText(input.timing),
      input.onRefused ?? 'skip',
      input.retryWindow ?? RETRY_WINDOW_DEFAULT,
      input.onMissed ?? MISSED_STRATEGY_DEFAULT,
      input.grace ?? GRACE_DEFAULT,
    ]),
  );
  return ok({ send, key: key.value, requestHash });
}

/** The timing as the request's hash reads it, in a fixed order, its defaults filled in. */
function timingText(timing: ScheduleTimingInput): (string | number | null)[] {
  if (timing.kind === 'once') {
    return [timing.kind, timing.at.toISOString()];
  }
  const bounds = [timing.start?.toISOString() ?? null, timing.end?.toISOString() ?? null, timing.count ?? null];
  return timing.kind === 'every' ? [timing.kind, timing.every, ...bounds] : [timing.kind, timing.cron, timing.timeZone ?? TIME_ZONE_DEFAULT, ...bounds];
}
