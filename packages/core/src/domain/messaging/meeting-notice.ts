import type { AccountId, IdGenerator, ShipId, ShipKind } from '@aeolus-fleet/common';

import { recordEvent, type EventLog } from '../shared/events.js';
import type { Notifier } from '../shared/notifier.js';
import { ok, type Result } from '../shared/result.js';
import type { Meeting } from './meeting.js';
import { acceptMessage, type AcceptRefusal } from './message.js';
import type { DeliveryRepository, MessageRepository, RequestHasher } from './ports.js';
import { sendRequestText } from './send-request.js';

export interface MeetingNoticeTx {
  messages: Pick<MessageRepository, 'create'>;
  deliveries: Pick<DeliveryRepository, 'create'>;
  events: EventLog;
  notifier: Notifier;
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
 * reaches every other.
 */
export async function tellParticipant(deps: { tx: MeetingNoticeTx; ids: IdGenerator; hasher: RequestHasher }, notice: MeetingNotice): Promise<Result<undefined, AcceptRefusal>> {
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
  const { message, delivery, events } = accepted.value;
  await tx.messages.create(message);
  await tx.deliveries.create(delivery);
  for (const event of events) {
    await recordEvent({ events: tx.events, ids }, event);
  }
  await tx.notifier.deliveryPending({ fleetId: meeting.fleetId, deliveryId: delivery.id, recipient: delivery.recipient });
  return ok(undefined);
}
