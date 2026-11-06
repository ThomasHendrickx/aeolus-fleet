import { RECORD_PAGE_SIZE_DEFAULT, type MessageId, type ShipId, type ShipKind } from '@aeolus-fleet/common';

import { holdLease, type HoldLeaseTx, type LeaseEnded } from '../registry/public.js';
import type { Crew } from '../shared/caller.js';
import type { DomainError } from '../shared/errors.js';
import type { Page } from '../shared/page.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { listedUnsealed, withDataKeysForList, type DataKeysNeeded, type ListedPayload, type PayloadSealing } from './data-keys.js';
import type { ExchangeList } from './ports.js';

export interface ReadExchangesTx extends HoldLeaseTx {
  exchanges: ExchangeList;
}

/** One exchange in the list: the other ship as it is now, the newest message between them, and how many of the other ship's messages are not yet acknowledged. */
export interface ExchangesEntry {
  otherShipId: ShipId;
  otherShipName: string;
  otherShipType: string;
  otherShipKind: ShipKind;
  unacknowledged: number;
  newestMessage: { messageId: MessageId; senderShipId: ShipId; payload: ListedPayload; contentType: string; sentAt: Date };
}

export type ReadExchangesRefusal = DomainError<'KEY_UNAVAILABLE'> | LeaseEnded;

export type ReadExchanges = (crew: Crew, input: { cursor?: MessageId; limit?: number }) => Promise<Result<Page<ExchangesEntry, MessageId>, ReadExchangesRefusal>>;

/**
 * Use case: a page of the crew's ship's list of exchanges (`exchanges`,
 * docs/design/exchange-read, E2, E4, E5, E10): per other ship, newest
 * exchange first, read from the rollup kept for person ships, so any other
 * ship lists none. Retired other ships are left out; their exchanges read by
 * id with `exchange`. Its scope (messages:receive) is checked before this
 * runs. It holds the crew's lease and reads without a lock. In a sealed fleet
 * each newest payload is unsealed, or marked unreadable when its key cannot
 * be had (decision 0068, B9).
 */
export function createReadExchanges(deps: { uow: UnitOfWork<ReadExchangesTx>; sealing: PayloadSealing }): ReadExchanges {
  return (crew, { cursor, limit = RECORD_PAGE_SIZE_DEFAULT }) =>
    withDataKeysForList({ sealing: deps.sealing, fleetId: crew.fleetId }, (keys) =>
      deps.uow.run(async (tx): Promise<Result<Page<ExchangesEntry, MessageId>, ReadExchangesRefusal | DataKeysNeeded>> => {
        const held = await holdLease(tx, crew);
        if (!held.isOk) {
          return held;
        }
        const page = await tx.exchanges.page({ fleetId: crew.fleetId, shipId: crew.shipId, cursor, limit });
        const items: ExchangesEntry[] = [];
        for (const { otherShip, newestMessage: message, unacknowledged } of page.items) {
          const payload = listedUnsealed(keys, { row: { fleetId: message.fleetId, rowId: message.id }, payload: message.payload });
          if (!payload.isOk) {
            return payload;
          }
          items.push({
            otherShipId: otherShip.id,
            otherShipName: otherShip.name,
            otherShipType: otherShip.type,
            otherShipKind: otherShip.kind,
            unacknowledged,
            newestMessage: { messageId: message.id, senderShipId: message.senderShipId, payload: payload.value, contentType: message.contentType, sentAt: message.createdAt },
          });
        }
        return ok({ items, nextCursor: page.nextCursor });
      }),
    );
}
