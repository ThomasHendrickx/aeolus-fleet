import { MEETING_ADDED_CONTENT_TYPE, type IdGenerator, type LabelValueId, type MeetingAdded, type MeetingId, type ShipId } from '@aeolus-fleet/common';

import {
  checkReach,
  keepingReachRefusal,
  resolveInvitees,
  type CheckReachTx,
  type Invitee,
  type NotReachable,
  type ResolveInviteesTx,
  type UnresolvableSelector,
} from '../registry/public.js';
import type { ShipCaller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { idempotencyKey } from '../shared/idempotency-key.js';
import type { Notifier } from '../shared/notifier.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { withinDailyMessageLimit, type DailyMessageLimitTx } from './daily-message-limit.js';
import { openMeeting, repeatOfOpen, type Meeting, type OpenMeetingRefusal } from './meeting.js';
import { acceptMessage, type AcceptRefusal } from './message.js';
import type { DeliveryRepository, MeetingRepository, MessageRepository, RequestHasher } from './ports.js';
import { sendRequestText } from './send-request.js';

export interface OpenMeetingTx extends Omit<ResolveInviteesTx, 'ships'>, Omit<CheckReachTx, 'ships'>, DailyMessageLimitTx {
  ships: ResolveInviteesTx['ships'] & CheckReachTx['ships'];
  meetings: MeetingRepository;
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  events: EventLog;
  notifier: Notifier;
}

export interface MeetingToOpen {
  /** The ships invited by id or by name. */
  ships?: readonly Invitee[];
  /** A label selection: the ships carrying every one of these values are invited too. */
  valueIds?: readonly LabelValueId[];
  idempotencyKey: string;
  /** The exact model the opener's session runs, which its added notices state, as a send does. */
  model?: string;
  /** A short name a person reads when auditing later. */
  title?: string;
}

export interface MeetingOpened {
  /** The meeting's id: the original one when the opener used the idempotency key before. */
  meetingId: MeetingId;
}

export type OpenMeetingFailure =
  | DomainError<'INVALID_IDEMPOTENCY_KEY' | 'IDEMPOTENCY_KEY_REUSED' | 'MESSAGE_LIMIT_REACHED'>
  | OpenMeetingRefusal
  | UnresolvableSelector
  | NotReachable
  | AcceptRefusal;

export type OpenMeeting = (caller: ShipCaller, input: MeetingToOpen) => Promise<Result<MeetingOpened, OpenMeetingFailure>>;

/**
 * Use case: the calling ship opens a meeting (`openMeeting`, decision 0061),
 * owning and moderating it. Its scope (meetings:open) is checked before this
 * runs. In one unit of work: the invitees resolved (by ship, then by label
 * selection), the opener reaching each by send as a send is checked, the
 * meeting with its participants and events, and for each participant but the
 * opener the added notice, a message from the opener to that ship with the
 * meeting on its envelope, its delivery, MessageAccepted and the notice that
 * wakes it. The opener gets the meeting's id only once all of it is
 * committed. An invitee the network rules keep the opener from reaching
 * refuses the open: only the refusal's record commits.
 *
 * A repeat, the same opener with the same key and the same request, answers
 * the original meeting and stores nothing; the same key with another request
 * is refused. Locks, in this order: the opener's key, then each invitee as
 * a send holds the ship it addresses, then the network settings, shared.
 */
export function createOpenMeeting(deps: { uow: UnitOfWork<OpenMeetingTx>; clock: Clock; ids: IdGenerator; hasher: RequestHasher }): OpenMeeting {
  return async (caller, input) => {
    const key = idempotencyKey(input.idempotencyKey);
    if (!key.isOk) {
      return key;
    }
    const ships = input.ships ?? [];
    const valueIds = input.valueIds ?? [];
    const title = input.title ?? null;
    const requestHash = deps.hasher.hash(JSON.stringify([ships.map(inviteeText), valueIds, title]));
    return keepingReachRefusal(deps.uow, (tx) => openWithin({ tx, ...deps }, { caller, ships, valueIds, title, idempotencyKey: key.value, requestHash, model: input.model }));
  };
}

/** An invitee as one text, as it was sent: one ship by id and by name are two requests. */
function inviteeText(invitee: Invitee): string[] {
  return 'shipId' in invitee ? ['id', invitee.shipId] : ['name', invitee.name];
}

async function openWithin(
  deps: { tx: OpenMeetingTx; clock: Clock; ids: IdGenerator; hasher: RequestHasher },
  open: { caller: ShipCaller; ships: readonly Invitee[]; valueIds: readonly LabelValueId[]; title: string | null; idempotencyKey: string; requestHash: string; model: string | undefined },
): Promise<Result<MeetingOpened, OpenMeetingFailure>> {
  const { tx, clock, ids } = deps;
  const { fleetId, shipId: openerShipId } = open.caller;
  const openerKey = { fleetId, openerShipId, idempotencyKey: open.idempotencyKey };
  await tx.meetings.lockOpenerKey(openerKey);
  const original = await tx.meetings.findByOpenerKey(openerKey);
  if (original) {
    const repeat = repeatOfOpen(original, open.requestHash);
    return repeat.isOk ? ok({ meetingId: repeat.value }) : repeat;
  }

  const invited = await resolveInvitees(tx, { fleetId, ships: open.ships, valueIds: open.valueIds });
  if (!invited.isOk) {
    return invited;
  }
  const at = clock.now();
  const opened = openMeeting({ meetingId: ids('meeting'), fleetId, title: open.title, openerShipId, invitedShipIds: invited.value, idempotencyKey: open.idempotencyKey, requestHash: open.requestHash, at });
  if (!opened.isOk) {
    return opened;
  }
  const { meeting, events } = opened.value;
  const told = meeting.participants.map(({ shipId }) => shipId).filter((shipId) => shipId !== openerShipId);
  for (const shipId of told) {
    const reach = await checkReach({ tx, ids }, { fleetId, senderShipId: openerShipId, recipient: { kind: 'ship', shipId }, isAnswerToSender: false, at });
    if (!reach.isOk) {
      return reach;
    }
  }
  const withinLimit = await withinDailyMessageLimit(tx, { fleetId, time: at });
  if (!withinLimit.isOk) {
    return withinLimit;
  }

  await tx.meetings.create(meeting);
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  const payload = JSON.stringify(await addedNotice(tx, meeting));
  for (const shipId of told) {
    const notice = await tellAdded(deps, { caller: open.caller, meeting, shipId, payload, model: open.model, at });
    if (!notice.isOk) {
      return notice;
    }
  }
  return ok({ meetingId: meeting.id });
}

/** The added notice's payload: the meeting, its title, its owner, its moderator and its participants, by id and name. */
async function addedNotice(tx: Pick<OpenMeetingTx, 'ships'>, meeting: Meeting): Promise<MeetingAdded> {
  const names = new Map<ShipId, string>();
  for (const { shipId } of meeting.participants) {
    const ship = await tx.ships.find(meeting.fleetId, shipId);
    names.set(shipId, ship?.name ?? shipId);
  }
  const party = (id: ShipId) => ({ id, name: names.get(id) ?? id });
  return { meetingId: meeting.id, title: meeting.title, owner: party(meeting.ownerShipId), moderator: party(meeting.moderatorShipId), participants: meeting.participants.map(({ shipId }) => party(shipId)) };
}

/**
 * The added notice to one participant (decision 0061, M11): a message from
 * the owner to that ship, the meeting on its envelope, with its pending
 * delivery, MessageAccepted and the notice that wakes it. No reach check: the
 * owner reached it already.
 */
async function tellAdded(
  deps: { tx: OpenMeetingTx; ids: IdGenerator; hasher: RequestHasher },
  notice: { caller: ShipCaller; meeting: Meeting; shipId: ShipId; payload: string; model: string | undefined; at: Date },
): Promise<Result<undefined, AcceptRefusal>> {
  const { tx, ids, hasher } = deps;
  const { caller, meeting, shipId, payload, at } = notice;
  const recipient = { kind: 'ship' as const, shipId };
  const messageId = ids('message');
  const accepted = acceptMessage(
    { recipient, repliedTo: undefined },
    {
      messageId,
      deliveryId: ids('delivery'),
      fleetId: meeting.fleetId,
      senderShipId: caller.shipId,
      payload,
      contentType: MEETING_ADDED_CONTENT_TYPE,
      model: notice.model,
      senderKind: caller.kind,
      // The fleet's own key for the notice, as a ping's is: one per message, never the opener's.
      idempotencyKey: `meeting-added-${messageId}`,
      requestHash: hasher.hash(sendRequestText({ selector: recipient, payload, contentType: MEETING_ADDED_CONTENT_TYPE, inReplyTo: undefined, isForced: false })),
      inReplyTo: undefined,
      isForced: false,
      meetingId: meeting.id,
      ...(caller.signedInAccountId === undefined ? {} : { signedInAccountId: caller.signedInAccountId }),
      at,
    },
  );
  if (!accepted.isOk) {
    return accepted;
  }
  const { message, delivery, events } = accepted.value;
  await tx.messages.create(message);
  await tx.deliveries.create(delivery);
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  await tx.notifier.deliveryPending({ fleetId: meeting.fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  return ok(undefined);
}
