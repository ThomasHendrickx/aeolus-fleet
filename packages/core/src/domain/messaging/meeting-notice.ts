import { MEETING_ENDED_CONTENT_TYPE, MEETING_MIC_CONTENT_TYPE, type AccountId, type IdGenerator, type MeetingAdded, type MeetingEnded, type MeetingMic, type MessageId, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import { recordEvent, type EventLog } from '../shared/events.js';
import type { Notifier } from '../shared/notifier.js';
import { ok, type Result } from '../shared/result.js';
import type { ShipRepository } from '../registry/public.js';
import { participantsBut, type Meeting } from './meeting.js';
import { acceptContribution, acceptMessage, type AcceptRefusal } from './message.js';
import type { DeliveryRepository, FleetSealingRepository, MessageRepository, RequestHasher } from './ports.js';
import { sealedMessage, unsealed, type DataKeysNeeded, type HeldDataKeys } from './data-keys.js';
import type { MicRequest } from './mic.js';
import type { DomainError } from '../shared/errors.js';
import type { MeetingRepository } from './ports.js';
import { sendRequestText } from './send-request.js';

export interface MeetingNoticeTx {
  messages: Pick<MessageRepository, 'create'>;
  deliveries: Pick<DeliveryRepository, 'create'>;
  sealings: Pick<FleetSealingRepository, 'currentDataKeyId'>;
  events: EventLog;
  notifier: Notifier;
}

/** What a notice is written with: in a sealed fleet its payload is sealed with the data keys held (decision 0068, B17). */
export interface MeetingNoticeDeps {
  tx: MeetingNoticeTx;
  ids: IdGenerator;
  hasher: RequestHasher;
  held: HeldDataKeys;
}

/** A notice to one participant: from which ship, of which content type, with what payload. */
export interface MeetingNotice {
  meeting: Meeting;
  senderShipId: ShipId;
  senderKind?: ShipKind;
  signedInAccountId?: AccountId;
  shipId: ShipId;
  contentType: string;
  payload: string;
  model: string | undefined;
  at: Date;
}

/**
 * A notice that tells one participant what changed in its meeting (decision
 * 0061, M11): a message from the ship that caused it to that ship, the
 * meeting on its envelope, with its pending delivery, MessageAccepted and the
 * notice that wakes it. No reach check: inside the meeting every participant
 * reaches every other. In a sealed fleet its payload is stored sealed, as
 * every payload is (decision 0068, B17).
 */
export async function tellParticipant(deps: MeetingNoticeDeps, notice: MeetingNotice): Promise<Result<undefined, AcceptRefusal | DataKeysNeeded>> {
  const { tx, ids, hasher } = deps;
  const { meeting, shipId, payload, contentType, at } = notice;
  const recipient = { kind: 'ship' as const, shipId };
  const messageId = ids('message');
  const accepted = acceptMessage(
    { recipient, repliedTo: undefined },
    {
      messageId,
      deliveryId: ids('delivery'),
      fleetId: meeting.fleetId,
      senderShipId: notice.senderShipId,
      payload,
      contentType,
      model: notice.model,
      ...(notice.senderKind === undefined ? {} : { senderKind: notice.senderKind }),
      // The fleet's own key for the notice, as a ping's is: one per message, never the caller's.
      idempotencyKey: `meeting-notice-${messageId}`,
      requestHash: hasher.hash(sendRequestText({ selector: recipient, payload, contentType, inReplyTo: undefined, isForced: false })),
      inReplyTo: undefined,
      isForced: false,
      meetingId: meeting.id,
      ...(notice.signedInAccountId === undefined ? {} : { signedInAccountId: notice.signedInAccountId }),
      at,
    },
  );
  if (!accepted.isOk) {
    return accepted;
  }
  const { delivery, events } = accepted.value;
  const message = await sealedMessage(deps, {
    message: accepted.value.message,
    sealedRequestHash: hasher.hash(sendRequestText({ selector: recipient, payload: undefined, contentType, inReplyTo: undefined, isForced: false })),
  });
  if (!message.isOk) {
    return message;
  }
  await tx.messages.create(message.value);
  await tx.deliveries.create(delivery, message.value);
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  await tx.notifier.deliveryPending({ fleetId: meeting.fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  return ok(undefined);
}

/** The added notice's payload: the meeting, its title, its owner, its moderator and its present participants, by id and name. */
export async function addedNoticeOf(tx: { ships: Pick<ShipRepository, 'find'> }, meeting: Meeting): Promise<MeetingAdded> {
  const names = new Map<ShipId, string>();
  const present = meeting.participants.filter(({ leftAt }) => leftAt === null);
  for (const { shipId } of present) {
    const ship = await tx.ships.find(meeting.fleetId, shipId);
    names.set(shipId, ship?.name ?? shipId);
  }
  const party = (id: ShipId) => ({ id, name: names.get(id) ?? id });
  return { meetingId: meeting.id, title: meeting.title, goal: meeting.goal, owner: party(meeting.ownerShipId), moderator: party(meeting.moderatorShipId), participants: present.map(({ shipId }) => party(shipId)) };
}

/**
 * The notices a change of the meeting owes (M11): to the ship that got the
 * mic by it, from the moderator; and once it ended, to every other present
 * participant, from the ship that ended it. Neither states a model: the change
 * may be another ship's, as a release under first in line or a retire.
 */
export async function tellOfChange(
  deps: MeetingChangeNoticeDeps,
  change: { meeting: Meeting; micGivenTo: ShipId | null; said?: MicRequest[]; saidByResponse?: ShipId; endedBy: ShipId | null; at: Date },
): Promise<Result<{ said: { shipId: ShipId; messageId: MessageId }[] }, AcceptRefusal | DataKeysNeeded | DomainError<'KEY_UNAVAILABLE'>>> {
  const { meeting, at } = change;
  const notices: MeetingNotice[] = [];
  const saidMessages: { shipId: ShipId; messageId: MessageId }[] = [];
  for (const request of change.said ?? []) {
    const said = await deliverWords(deps, { meeting, request, at });
    if (!said.isOk) return said;
    if (said.value !== undefined) saidMessages.push({ shipId: request.shipId, messageId: said.value });
    if (request.shipId !== change.saidByResponse && request.words !== undefined) {
      notices.push({ meeting, senderShipId: meeting.moderatorShipId, shipId: request.shipId, contentType: MEETING_MIC_CONTENT_TYPE, payload: JSON.stringify({ meetingId: meeting.id, messageId: said.value }), model: undefined, at });
    }
  }
  if (change.micGivenTo !== null) {
    const payload: MeetingMic = { meetingId: meeting.id };
    notices.push({ meeting, senderShipId: meeting.moderatorShipId, shipId: change.micGivenTo, contentType: MEETING_MIC_CONTENT_TYPE, payload: JSON.stringify(payload), model: undefined, at });
  }
  if (change.endedBy !== null) {
    for (const shipId of participantsBut(meeting, change.endedBy)) {
      const request = meeting.micRequests.find((waiting) => waiting.shipId === shipId && waiting.words !== undefined);
      const payload: MeetingEnded = { meetingId: meeting.id, ...(request === undefined ? {} : { unsaidRequest: { shipId, requestedAt: request.requestedAt.toISOString() } }) };
      notices.push({ meeting, senderShipId: change.endedBy, shipId, contentType: MEETING_ENDED_CONTENT_TYPE, payload: JSON.stringify(payload), model: undefined, at });
    }
  }
  for (const notice of notices) {
    const told = await tellParticipant(deps, notice);
    if (!told.isOk) {
      return told;
    }
  }
  return ok({ said: saidMessages });
}

type MeetingChangeNoticeDeps = MeetingNoticeDeps & { tx: MeetingNoticeTx & { meetings: Pick<MeetingRepository, 'contributed'> } };

/** Delivers words already spoken by the requesting ship, under the meeting lock and in the granting transaction. */
async function deliverWords(deps: MeetingChangeNoticeDeps, input: { meeting: Meeting; request: MicRequest; at: Date }): Promise<Result<MessageId | undefined, AcceptRefusal | DataKeysNeeded | DomainError<'KEY_UNAVAILABLE'>>> {
  const { meeting, request, at } = input;
  const { words } = request;
  if (words === undefined) return ok(undefined);
  const plain = unsealed(deps.held, { row: { fleetId: meeting.fleetId, rowId: words.messageId }, payload: words.payload });
  if (!plain.isOk) return plain;
  const accepted = acceptContribution({ messageId: deps.ids('message'), fleetId: meeting.fleetId, senderShipId: request.shipId,
    senderKind: words.senderKind, senderLeaseId: words.senderLeaseId, signedInAccountId: words.signedInAccountId,
    meetingId: meeting.id, deliveries: participantsBut(meeting, request.shipId).map((shipId) => ({ deliveryId: deps.ids('delivery'), shipId })),
    payload: plain.value, contentType: words.contentType, model: words.model, idempotencyKey: `meeting-words-${words.messageId}`, requestHash: '', at });
  if (!accepted.isOk) return accepted;
  const text = { selector: accepted.value.message.selector, contentType: words.contentType, inReplyTo: undefined, isForced: false };
  const message = await sealedMessage(deps, { message: { ...accepted.value.message, requestHash: deps.hasher.hash(sendRequestText({ ...text, payload: plain.value })) }, sealedRequestHash: deps.hasher.hash(sendRequestText({ ...text, payload: undefined })) });
  if (!message.isOk) return message;
  await deps.tx.messages.create(message.value);
  for (const delivery of accepted.value.deliveries) await deps.tx.deliveries.create(delivery, message.value);
  await deps.tx.meetings.contributed(meeting.fleetId, { meetingId: meeting.id, at });
  for (const event of accepted.value.events) await recordEvent({ events: deps.tx.events, ids: deps.ids }, event);
  for (const delivery of accepted.value.deliveries) await deps.tx.notifier.deliveryPending({ fleetId: meeting.fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  return ok(message.value.id);
}
