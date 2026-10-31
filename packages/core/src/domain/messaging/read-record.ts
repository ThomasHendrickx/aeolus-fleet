import { RECORD_PAGE_SIZE_DEFAULT, type DeliveryId, type DeliveryState } from '@aeolus-fleet/common';

import { holdLease, type HoldLeaseTx, type LeaseEnded, type ShipRepository } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Page } from '../shared/page.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { listedUnsealed, withDataKeysForList, type DataKeysNeeded, type ListedPayload, type PayloadSealing } from './data-keys.js';
import type { DeliveryRepository } from './ports.js';
import type { ReceivedDelivery } from './receive-deliveries.js';

export interface ReadRecordTx extends HoldLeaseTx {
  ships: Pick<ShipRepository, 'find' | 'findMany'>;
  deliveries: Pick<DeliveryRepository, 'findRecordPage'>;
}

/** A delivery in its ship's record: as a receive hands one, with its state, its payload unreadable when its data key cannot be had. */
export interface RecordEntry extends Omit<ReceivedDelivery, 'payload'> {
  payload: ListedPayload;
  state: DeliveryState;
}

export type ReadRecordRefusal = DomainError<'SHIP_NOT_FOUND' | 'KEY_UNAVAILABLE'> | LeaseEnded;

export type ReadRecord = (crew: Crew, input: { cursor?: DeliveryId; limit?: number }) => Promise<Result<Page<RecordEntry, DeliveryId>, ReadRecordRefusal>>;

/**
 * Use case: a page of the crew's own ship's record (`record`, Bridge, CC12):
 * the deliveries to it and those of its type it claimed, each with its
 * message, in any state and whichever of its leases took them, newest first,
 * as far back as the fleet's retention keeps them. Its scope
 * (messages:receive) is checked before this runs. It holds the crew's lease,
 * so an ended lease is refused, and reads without a lock: it hands, counts
 * and records nothing. In a sealed fleet each payload is unsealed, or marked
 * unreadable when its key cannot be had (decision 0068, B9).
 */
export function createReadRecord(deps: { uow: UnitOfWork<ReadRecordTx>; sealing: PayloadSealing }): ReadRecord {
  return (crew, { cursor, limit = RECORD_PAGE_SIZE_DEFAULT }) =>
    withDataKeysForList({ sealing: deps.sealing, fleetId: crew.fleetId }, (keys) =>
      deps.uow.run(async (tx): Promise<Result<Page<RecordEntry, DeliveryId>, ReadRecordRefusal | DataKeysNeeded>> => {
        const held = await holdLease(tx, crew);
        if (!held.isOk) {
          return held;
        }
        const page = await tx.deliveries.findRecordPage({ fleetId: crew.fleetId, shipId: crew.shipId, cursor, limit });
        const senderIds = [...new Set(page.items.map(({ message }) => message.senderShipId))];
        const senders = new Map((await tx.ships.findMany(crew.fleetId, senderIds)).map((ship) => [ship.id, ship]));
        const items: RecordEntry[] = [];
        for (const { delivery, message } of page.items) {
          const payload = listedUnsealed(keys, { row: { fleetId: message.fleetId, rowId: message.id }, payload: message.payload });
          if (!payload.isOk) {
            return payload;
          }
          const sender = senders.get(message.senderShipId);
          if (!sender) {
            // Never happens: ships are never deleted, and the foreign key keeps the sender in its fleet.
            return refuse('SHIP_NOT_FOUND', `Ship ${message.senderShipId} does not exist`);
          }
          items.push({
            deliveryId: delivery.id,
            messageId: message.id,
            senderShipId: message.senderShipId,
            senderName: sender.name,
            senderType: sender.type,
            recipient: delivery.recipient,
            payload: payload.value,
            contentType: message.contentType,
            model: message.model,
            inReplyTo: message.inReplyToMessageId,
            sentAt: message.createdAt,
            attempts: delivery.attempts,
            isForced: delivery.isForced,
            meetingId: message.meetingId,
            scheduleId: message.scheduleId,
            sendTime: message.sendTime,
            state: delivery.state,
          });
        }
        return ok({ items, nextCursor: page.nextCursor });
      }),
    );
}
