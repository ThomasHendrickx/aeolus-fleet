import { RECORD_PAGE_SIZE_DEFAULT, type DeliveryId, type DeliveryState, type MessageId, type ShipId } from '@aeolus-fleet/common';

import { holdLease, type HoldLeaseTx, type LeaseEnded, type ShipRepository } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { listedUnsealed, withDataKeysForList, type DataKeysNeeded, type ListedPayload, type PayloadSealing } from './data-keys.js';
import { isInExchange } from './exchange.js';
import type { DeliveryRepository, ExchangedDelivery, MessageRepository, PrunedExchanges } from './ports.js';

export interface ReadExchangeTx extends HoldLeaseTx {
  ships: Pick<ShipRepository, 'find'>;
  messages: Pick<MessageRepository, 'find'>;
  deliveries: Pick<DeliveryRepository, 'findExchangePage' | 'findOfMessageReaching'>;
  prunedExchanges: PrunedExchanges;
}

/** The caller's own delivery of a message it received: its id and where it stands (docs/design/exchange-read, section 7). */
export interface ReceivedDelivery {
  deliveryId: DeliveryId;
  state: DeliveryState;
}

/**
 * One message of an exchange, whole; on the caller's own, where the other
 * ship's delivery of it stands; on one it received, the caller's own delivery.
 */
export interface ExchangeEntry {
  messageId: MessageId;
  senderShipId: ShipId;
  payload: ListedPayload;
  contentType: string;
  inReplyTo: MessageId | null;
  sentAt: Date;
  deliveryState: DeliveryState | null;
  receivedDelivery: ReceivedDelivery | null;
}

/**
 * A page of an exchange, newest first, with the cursor each way while more lie
 * that way, and the send time of the newest message of the exchange pruning
 * removed, null when it removed none (docs/design/exchange-history).
 */
export interface ExchangePage {
  items: ExchangeEntry[];
  olderCursor: DeliveryId | null;
  newerCursor: DeliveryId | null;
  prunedUpTo: Date | null;
}

export type ReadExchangeRefusal = DomainError<'SHIP_NOT_FOUND' | 'MESSAGE_NOT_FOUND' | 'KEY_UNAVAILABLE'> | LeaseEnded;

export interface ExchangeToRead {
  otherShipId: ShipId;
  before?: DeliveryId;
  after?: DeliveryId;
  around?: MessageId;
  limit?: number;
}

export type ReadExchange = (crew: Crew, input: ExchangeToRead) => Promise<Result<ExchangePage, ReadExchangeRefusal>>;

/**
 * Use case: a page of the crew's ship's exchange with one other ship
 * (`exchange`, docs/design/exchange-read): every message one of them sent
 * that reached the other, newest first, the newest page, older or newer from
 * a cursor, or the page around one message (E9). The other ship is named by
 * id, retired or not, within the crew's fleet (E2, E10). Its scope
 * (messages:receive) is checked before this runs. It holds the crew's lease
 * and reads without a lock: it hands, counts and records nothing. In a sealed
 * fleet each payload is unsealed, or marked unreadable when its key cannot be
 * had (decision 0068, B9). Every page answers how far pruning went in the
 * exchange, read after the page's rows: a batch that commits between the two
 * reads answers its messages with its mark, never the messages gone without
 * it (docs/design/exchange-history, section 5).
 */
export function createReadExchange(deps: { uow: UnitOfWork<ReadExchangeTx>; sealing: PayloadSealing }): ReadExchange {
  return (crew, input) =>
    withDataKeysForList({ sealing: deps.sealing, fleetId: crew.fleetId }, (keys) =>
      deps.uow.run(async (tx): Promise<Result<ExchangePage, ReadExchangeRefusal | DataKeysNeeded>> => {
        const held = await holdLease(tx, crew);
        if (!held.isOk) {
          return held;
        }
        const other = await tx.ships.find(crew.fleetId, input.otherShipId);
        if (!other) {
          return refuse('SHIP_NOT_FOUND', `Ship ${input.otherShipId} does not exist`);
        }
        const page = await exchangePageWithin(tx, { crew, input });
        if (!page.isOk) {
          return page;
        }
        const items: ExchangeEntry[] = [];
        for (const { delivery, message } of page.value.rows) {
          const payload = listedUnsealed(keys, { row: { fleetId: message.fleetId, rowId: message.id }, payload: message.payload });
          if (!payload.isOk) {
            return payload;
          }
          items.push({
            messageId: message.id,
            senderShipId: message.senderShipId,
            payload: payload.value,
            contentType: message.contentType,
            inReplyTo: message.inReplyToMessageId,
            sentAt: message.createdAt,
            // The row is the other ship's delivery on the caller's own message, and the caller's own on one it received: the page reads only those.
            ...(message.senderShipId === crew.shipId
              ? { deliveryState: delivery.state, receivedDelivery: null }
              : { deliveryState: null, receivedDelivery: { deliveryId: delivery.id, state: delivery.state } }),
          });
        }
        const prunedUpTo = await tx.prunedExchanges.prunedUpTo(crew.fleetId, { shipId: crew.shipId, otherShipId: input.otherShipId });
        return ok({ items, olderCursor: page.value.olderCursor, newerCursor: page.value.newerCursor, prunedUpTo });
      }),
    );
}

interface ExchangeRows {
  rows: ExchangedDelivery[];
  olderCursor: DeliveryId | null;
  newerCursor: DeliveryId | null;
}

/**
 * The rows of the page asked, newest first, each part read one past its size
 * so its cursor says whether more lie that way. A cursor is a delivery id, so
 * the page goes on from it even once its message is pruned.
 */
async function exchangePageWithin(tx: ReadExchangeTx, { crew, input }: { crew: Crew; input: ExchangeToRead }): Promise<Result<ExchangeRows, DomainError<'MESSAGE_NOT_FOUND'>>> {
  const { otherShipId, before, after, around, limit = RECORD_PAGE_SIZE_DEFAULT } = input;
  const exchange = { fleetId: crew.fleetId, shipId: crew.shipId, otherShipId };
  if (around !== undefined) {
    const at = await deliveryInExchange(tx, { crew, otherShipId, messageId: around });
    if (at === undefined) {
      return refuse('MESSAGE_NOT_FOUND', `Message ${around} is not in your exchange with ship ${otherShipId}`);
    }
    // Half the page newer, then the message and the older ones: 10, it and 9 for a page of 20 (E9).
    const newerSize = Math.floor(limit / 2);
    const olderSize = limit - newerSize;
    const newer = newerSize === 0 ? [] : await tx.deliveries.findExchangePage({ ...exchange, toward: 'newer', from: at, limit: newerSize + 1 });
    const older = await tx.deliveries.findExchangePage({ ...exchange, toward: 'older', from: at, isFromIncluded: true, limit: olderSize + 1 });
    const newerRows = newer.length > newerSize ? newer.slice(1) : newer;
    const olderRows = older.slice(0, olderSize);
    return ok({
      rows: [...newerRows, ...olderRows],
      olderCursor: cursorOf(olderRows, { isMoreBeyond: older.length > olderSize, end: 'last' }),
      newerCursor: cursorOf(newerRows, { isMoreBeyond: newer.length > newerSize, end: 'first' }),
    });
  }
  if (after !== undefined) {
    const newer = await tx.deliveries.findExchangePage({ ...exchange, toward: 'newer', from: after, limit: limit + 1 });
    const rows = newer.length > limit ? newer.slice(1) : newer;
    return ok({ rows, olderCursor: rows.at(-1)?.delivery.id ?? after, newerCursor: cursorOf(rows, { isMoreBeyond: newer.length > limit, end: 'first' }) });
  }
  const older = await tx.deliveries.findExchangePage({ ...exchange, toward: 'older', ...(before !== undefined && { from: before }), limit: limit + 1 });
  const rows = older.slice(0, limit);
  return ok({ rows, olderCursor: cursorOf(rows, { isMoreBeyond: older.length > limit, end: 'last' }), newerCursor: before === undefined ? null : (rows[0]?.delivery.id ?? before) });
}

/** The cursor that goes on from the page's end, its oldest (`last`) or its newest (`first`), while more lie beyond it. */
function cursorOf(rows: readonly ExchangedDelivery[], { isMoreBeyond, end }: { isMoreBeyond: boolean; end: 'first' | 'last' }): DeliveryId | null {
  const row = end === 'first' ? rows[0] : rows.at(-1);
  return isMoreBeyond && row ? row.delivery.id : null;
}

/** The delivery by which the message is in the exchange: from the other ship to the crew's, or from the crew's to the other. */
async function deliveryInExchange(tx: ReadExchangeTx, at: { crew: Crew; otherShipId: ShipId; messageId: MessageId }): Promise<DeliveryId | undefined> {
  const { crew } = at;
  const message = await tx.messages.find(crew.fleetId, at.messageId);
  if (!message || !isInExchange(message)) {
    return undefined;
  }
  const reachedShipId = message.senderShipId === at.otherShipId ? crew.shipId : message.senderShipId === crew.shipId ? at.otherShipId : undefined;
  if (reachedShipId === undefined) {
    return undefined;
  }
  const delivery = await tx.deliveries.findOfMessageReaching(crew.fleetId, { messageId: message.id, shipId: reachedShipId });
  return delivery?.id;
}
