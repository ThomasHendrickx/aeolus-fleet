import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { Recipient } from '../shared/selector.js';
import type { Delivery, Message } from './message.js';

/** One sender's idempotency key, in its fleet. */
export interface SenderKey {
  fleetId: FleetId;
  senderShipId: ShipId;
  idempotencyKey: string;
}

/** Outbound port: messages, always within one fleet. Never changed once stored. */
export interface MessageRepository {
  create(message: Message): Promise<void>;
  /**
   * Holds the lock on the sender's idempotency key until the unit of work
   * ends, so two sends with one key never both find it unused: the second
   * waits, then finds the first one's message. Taken before anything else a
   * send locks.
   */
  lockIdempotencyKey(key: SenderKey): Promise<void>;
  /** The message the sender stored with this key, if any. */
  findByIdempotencyKey(key: SenderKey): Promise<Message | undefined>;
  find(fleetId: FleetId, messageId: MessageId): Promise<Message | undefined>;
}

/**
 * Outbound port: hashes a send's request text (SHA-256). The message keeps the
 * hash, so a repeat of its key is told from a reuse without storing the
 * request twice.
 */
export interface RequestHasher {
  hash(request: string): string;
}

/** Outbound port: deliveries, always within one fleet. */
export interface DeliveryRepository {
  create(delivery: Delivery): Promise<void>;
}

/** Which delivery is pending, and for whom: never its payload. */
export interface DeliveryNotice {
  fleetId: FleetId;
  deliveryId: DeliveryId;
  recipient: Recipient;
}

/**
 * Outbound port: wakes whoever waits to receive a delivery. Sent as part of
 * the caller's unit of work: it reaches listeners only once that commits, and
 * never when it rolls back, so nobody is woken for a message that does not exist.
 */
export interface Notifier {
  deliveryPending(notice: DeliveryNotice): Promise<void>;
}
