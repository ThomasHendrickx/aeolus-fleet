/**
 * The event log on Postgres, numbered in commit order. An event id is taken
 * when the event is written, before its transaction commits, so ids of
 * concurrent transactions do not follow commit order and cannot tell a live
 * subscription where to resume. Each event therefore also gets `seq`, its
 * place in its fleet's stream.
 *
 * The log holds a unit of work's events until it is about to commit, then
 * takes their numbers from `fleets.last_event_seq` as the transaction's last
 * statements. The row lock on the fleet is held until commit, so a lower
 * number always commits first and the numbers have no gaps; nothing is locked
 * after it, so it adds no deadlock. The notice goes out on commit only.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { EventLog, FleetEvent, FleetEventFeed } from '../../core/shared/events.js';
import type { Db } from './client.js';
import { toLastEventSeq, toSequencedEvent } from './rows.js';

/** The one channel every committed event is announced on, with its fleet and the last number. */
export const FLEET_EVENT_CHANNEL = 'aeolus_event';

export interface BufferedEventLog extends EventLog {
  /** Numbers and writes the held events and announces them. The unit of work's last step before commit. */
  flush(): Promise<void>;
}

export function createPrismaEventLog(db: Db): BufferedEventLog {
  const held: FleetEvent[] = [];

  return {
    append: (event) => {
      held.push(event);
      return Promise.resolve();
    },
    flush: async () => {
      const fleets = [...new Set(held.map((event) => event.fleetId))].toSorted();
      for (const fleetId of fleets) {
        await writeNumbered(db, { fleetId, events: held.filter((event) => event.fleetId === fleetId) });
      }
      held.length = 0;
    },
  };
}

async function writeNumbered(db: Db, of: { fleetId: FleetId; events: FleetEvent[] }): Promise<void> {
  const { fleetId, events } = of;
  const [row] = await db.$queryRaw<unknown[]>`
    UPDATE fleets SET last_event_seq = last_event_seq + ${events.length}
    WHERE id = ${fleetId}
    RETURNING last_event_seq`;
  const lastSeq = toLastEventSeq(row);
  const firstSeq = lastSeq - events.length + 1;
  await db.event.createMany({
    data: events.map((event, index) => ({
      id: event.id,
      fleetId: event.fleetId,
      type: event.type,
      occurredAt: event.occurredAt,
      actorShipId: event.actor.kind === 'ship' ? event.actor.shipId : null,
      shipId: event.shipId ?? null,
      messageId: event.messageId ?? null,
      deliveryId: event.deliveryId ?? null,
      details: event.details,
      seq: BigInt(firstSeq + index),
    })),
  });
  await db.$executeRaw`SELECT pg_notify(${FLEET_EVENT_CHANNEL}, ${JSON.stringify({ fleetId, seq: lastSeq })})`;
}

/** Reads committed events by number. Each read is one statement, outside a unit of work. */
export function createPrismaFleetEventFeed(db: Db): FleetEventFeed {
  return {
    lastSeq: async (fleetId) => {
      const fleet = await db.fleet.findUnique({ where: { id: fleetId }, select: { lastEventSeq: true } });
      return Number(fleet?.lastEventSeq ?? 0);
    },
    after: async (fleetId, { seq, limit }) => {
      const rows = await db.event.findMany({
        where: { fleetId, seq: { gt: seq } },
        orderBy: { seq: 'asc' },
        take: limit,
      });
      return rows.map(toSequencedEvent);
    },
  };
}
