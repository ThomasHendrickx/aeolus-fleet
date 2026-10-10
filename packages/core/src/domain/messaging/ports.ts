import type { DeliveryId, FleetId, LeaseId, MessageId, ShipId } from '@aeolus-fleet/common';

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
  /**
   * Holds the fleet's daily message-count lock until the unit of work ends, so
   * two sends at the daily limit never both see room for one more.
   */
  lockDailyCount(fleetId: FleetId): Promise<void>;
  /** How many messages the fleet stored at or after `since`, of any kind and from any sender. */
  countCreatedSince(fleetId: FleetId, since: Date): Promise<number>;
}

/**
 * Outbound port: hashes a send's request text (SHA-256). The message keeps the
 * hash, so a repeat of its key is told from a reuse without storing the
 * request twice.
 */
export interface RequestHasher {
  hash(request: string): string;
}

/** Which deliveries a crew may claim, and at most how many. */
export interface ClaimableDeliveries {
  fleetId: FleetId;
  /** The crew's ship, and its type: deliveries pending for either are the crew's to claim. */
  shipId: ShipId;
  type: string;
  /** The crew's lease: deliveries in flight with it are returned again. */
  leaseId: LeaseId;
  limit: number;
  /** Deliveries this receive has already claimed, left out. */
  excluding: readonly DeliveryId[];
}

/** A delivery a crew may claim, with the message it carries. */
export interface ClaimableDelivery {
  delivery: Delivery;
  message: Message;
}

/** Outbound port: deliveries, always within one fleet. */
export interface DeliveryRepository {
  create(delivery: Delivery): Promise<void>;
  /**
   * Up to `limit` deliveries the crew may claim, each with its message: first
   * those in flight with the crew's lease, then those pending for its ship or
   * its type, oldest first within each. Each is locked until the unit of work
   * ends, and one that another unit of work holds is skipped, never waited
   * for: two receivers never get the same delivery (ADR 0003).
   */
  findClaimableForUpdate(query: ClaimableDeliveries): Promise<ClaimableDelivery[]>;
  /**
   * How many deliveries the crew's next receive would hand it: those in
   * flight with its lease, and those pending for its ship or its type. Locks
   * nothing and claims nothing.
   */
  countReceivable(query: Omit<ClaimableDeliveries, 'limit' | 'excluding'>): Promise<number>;
  /** The delivery, locked until the unit of work ends. */
  findForUpdate(fleetId: FleetId, deliveryId: DeliveryId): Promise<Delivery | undefined>;
  /** The one delivery a message has, read without a lock. */
  findOfMessage(fleetId: FleetId, messageId: MessageId): Promise<Delivery | undefined>;
  /**
   * The ping to the ship whose delivery is still open, pending or in flight:
   * at most one, since pings never stack. Locks nothing: a ping holds the ship.
   */
  findOpenPing(fleetId: FleetId, shipId: ShipId): Promise<Message | undefined>;
  /** Stores the delivery's state, its claim and its attempts. */
  update(delivery: Delivery): Promise<void>;
  /**
   * Records that the delivery's recipient read it at `at`, keeping an earlier
   * read: read is how the operator sees a message, not a delivery state.
   */
  markRead(read: { fleetId: FleetId; deliveryId: DeliveryId; at: Date }): Promise<void>;
  /** Forgets that the delivery was read: unread again. */
  markUnread(read: { fleetId: FleetId; deliveryId: DeliveryId }): Promise<void>;
}

/** Where a waiting receive listens: its ship, and the queue of its type, in its fleet. */
export interface ReceiverAddress {
  fleetId: FleetId;
  shipId: ShipId;
  type: string;
}

/**
 * Outbound port: wakes a waiting receive when a delivery may be pending for its
 * ship or its type. A wake-up is a hint to look again, never a delivery: the
 * receive finds out in the database whether one is there for it.
 */
export interface ReceiverWakeups {
  /** Starts watching. A wake-up that comes before the next wait is kept for it. */
  watch(address: ReceiverAddress): ReceiverWatch;
}

export interface ReceiverWatch {
  /** Settles when the receive is woken, or once `waitMs` has passed. */
  next(waitMs: number): Promise<'woken' | 'timedOut'>;
  /** Stops watching. */
  stop(): void;
}
