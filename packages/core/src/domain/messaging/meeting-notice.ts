import { MEETING_ENDED_CONTENT_TYPE, MEETING_MIC_CONTENT_TYPE, type AccountId, type IdGenerator, type MeetingAdded, type MeetingEnded, type MeetingMic, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import { recordEvent, type EventLog } from '../shared/events.js';
import type { Notifier } from '../shared/notifier.js';
import { ok, type Result } from '../shared/result.js';
import type { ShipRepository } from '../registry/public.js';
import { participantsBut, type Meeting } from './meeting.js';
import { acceptMessage, type AcceptRefusal } from './message.js';
import type { DeliveryRepository, FleetSealingRepository, MessageRepository, RequestHasher } from './ports.js';
import { sealedMessage, type DataKeysNeeded, type HeldDataKeys } from './data-keys.js';
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
  await tx.deliveries.create(delivery);
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
  return { meetingId: meeting.id, title: meeting.title, owner: party(meeting.ownerShipId), moderator: party(meeting.moderatorShipId), participants: present.map(({ shipId }) => party(shipId)) };
}

/**
 * The notices a change of the meeting owes (M11): to the ship that got the
 * mic by it, from the moderator; and once it ended, to every other present
 * participant, from the ship that ended it. Neither states a model: the change
 * may be another ship's, as a release under first in line or a retire.
 */
export async function tellOfChange(
  deps: MeetingNoticeDeps,
  change: { meeting: Meeting; micGivenTo: ShipId | null; endedBy: ShipId | null; at: Date },
): Promise<Result<undefined, AcceptRefusal | DataKeysNeeded>> {
  const { meeting, at } = change;
  const notices: MeetingNotice[] = [];
  if (change.micGivenTo !== null) {
    const payload: MeetingMic = { meetingId: meeting.id };
    notices.push({ meeting, senderShipId: meeting.moderatorShipId, shipId: change.micGivenTo, contentType: MEETING_MIC_CONTENT_TYPE, payload: JSON.stringify(payload), model: undefined, at });
  }
  if (change.endedBy !== null) {
    const payload: MeetingEnded = { meetingId: meeting.id };
    for (const shipId of participantsBut(meeting, change.endedBy)) {
      notices.push({ meeting, senderShipId: change.endedBy, shipId, contentType: MEETING_ENDED_CONTENT_TYPE, payload: JSON.stringify(payload), model: undefined, at });
    }
  }
  for (const notice of notices) {
    const told = await tellParticipant(deps, notice);
    if (!told.isOk) {
      return told;
    }
  }
  return ok(undefined);
}
