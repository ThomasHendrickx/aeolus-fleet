import type { InboxMessage, ListedShip, ShipId, ShipOutsideReadReach, ShipStatus } from '@aeolus-fleet/common';
import { isInReadReach } from '@aeolus-fleet/common/rules';

import { EVERY_SHIP_STATUS } from './every-ship-status';
import type { PluginAnswer } from './plugin-answer';
import { shipIdBatchesOf } from './ship-id-batches';

/**
 * The ships an inbox read names, as `fleet.list` lists them (decision 4 of
 * the performance design): its senders by id, retired ones too, for their
 * type, and each sender's name, for whether another ship has it. Never the
 * whole fleet. Only the ships argo reads whole (decision 0034).
 */

/** A read of `fleet.list`: one page, as many ships as the limit. */
export type ListShips = (input: { shipIds?: ShipId[]; name?: string; status: ShipStatus[]; limit: number }) => Promise<PluginAnswer<{ items: (ListedShip | ShipOutsideReadReach)[] }>>;

/** Two ships of a name are enough to tell whether another ship than the sender has it. */
const SHIPS_PER_NAME = 2;

export async function readInboxSenders(inbox: readonly InboxMessage[], list: ListShips): Promise<PluginAnswer<ListedShip[]>> {
  const senders = inbox.map(({ message }) => message.sender);
  const names = [...new Set(senders.map(({ name }) => name))];
  const reads = await Promise.all([
    ...shipIdBatchesOf(senders.map(({ id }) => id)).map((shipIds) => list({ shipIds, status: EVERY_SHIP_STATUS, limit: shipIds.length })),
    ...names.map((name) => list({ name, status: EVERY_SHIP_STATUS, limit: SHIPS_PER_NAME })),
  ]);
  const ships: ListedShip[] = [];
  for (const read of reads) {
    if (read.kind === 'refused') {
      return read;
    }
    ships.push(...read.data.items.filter(isInReadReach));
  }
  return { kind: 'answered', data: [...new Map(ships.map((ship) => [ship.id, ship])).values()] };
}
