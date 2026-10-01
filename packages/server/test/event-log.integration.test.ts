import { createIdGenerator, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { listenForPendingDeliveries } from '../src/adapters/prisma/delivery-notices.js';
import { createPrismaFleetEventFeed } from '../src/adapters/prisma/event-log.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import type { FleetEvent } from '../src/core/shared/events.js';
import { SYSTEM } from '../src/core/shared/events.js';
import { refuse } from '../src/core/shared/errors.js';
import { ok } from '../src/core/shared/result.js';
import { createMigratedDatabase } from './support/database.js';

// The event log's stream position on a real Postgres. Event ids are taken when
// an event is written, not when its transaction commits, so they cannot tell a
// browser where to resume. Each event gets a sequence number per fleet in
// commit order instead, with no gaps, and a notice once it has committed.

const newId = createIdGenerator();

let databaseUrl: string;
let prisma: PrismaClient;

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function aFleet(): Promise<FleetId> {
  const fleetId = newId('fleet');
  await createPrismaUnitOfWork(prisma).run(async (tx) => {
    await tx.fleets.create({ id: fleetId, name: 'home fleet', createdAt: new Date('2026-09-29T12:00:00.000Z') });
    return ok(undefined);
  });
  return fleetId;
}

function anEvent(fleetId: FleetId): FleetEvent {
  return {
    id: newId('event'),
    fleetId,
    type: 'FleetInitialised',
    occurredAt: new Date('2026-09-29T12:00:00.000Z'),
    actor: SYSTEM,
    details: {},
  };
}

async function appendInOwnUnit(event: FleetEvent): Promise<void> {
  await createPrismaUnitOfWork(prisma).run(async (tx) => {
    await tx.events.append(event);
    return ok(undefined);
  });
}

async function sequenceOf(fleetId: FleetId): Promise<{ id: string; seq: number }[]> {
  const rows = await prisma.$queryRaw<{ id: string; seq: bigint }[]>`
    SELECT id, seq FROM events WHERE fleet_id = ${fleetId} ORDER BY seq`;
  return rows.map(({ id, seq }) => ({ id, seq: Number(seq) }));
}

describe('the event sequence', () => {
  it('numbers the events of a fleet 1, 2, 3 in the order they were appended within one unit of work', async () => {
    const fleetId = await aFleet();
    const events = [anEvent(fleetId), anEvent(fleetId), anEvent(fleetId)];

    await createPrismaUnitOfWork(prisma).run(async (tx) => {
      for (const event of events) {
        await tx.events.append(event);
      }
      return ok(undefined);
    });

    await expect(sequenceOf(fleetId)).resolves.toEqual(events.map((event, index) => ({ id: event.id, seq: index + 1 })));
  });

  it('numbers events in commit order: a transaction that wrote its event first but commits last comes last', async () => {
    const fleetId = await aFleet();
    const early = anEvent(fleetId);
    const late = anEvent(fleetId);
    expect(early.id < late.id).toBe(true);
    const lateCommitted = Promise.withResolvers<undefined>();

    const slow = createPrismaUnitOfWork(prisma).run(async (tx) => {
      await tx.events.append(early);
      await lateCommitted.promise;
      return ok(undefined);
    });
    await appendInOwnUnit(late);
    lateCommitted.resolve(undefined);
    await slow;

    await expect(sequenceOf(fleetId)).resolves.toEqual([
      { id: late.id, seq: 1 },
      { id: early.id, seq: 2 },
    ]);
  });

  it('leaves no gap for a unit of work that refused: the next commit takes the next number', async () => {
    const fleetId = await aFleet();
    const first = anEvent(fleetId);
    const refused = anEvent(fleetId);
    const next = anEvent(fleetId);

    await appendInOwnUnit(first);
    await createPrismaUnitOfWork(prisma).run(async (tx) => {
      await tx.events.append(refused);
      return refuse('SHIP_NOT_FOUND', 'refused after an event');
    });
    await appendInOwnUnit(next);

    await expect(sequenceOf(fleetId)).resolves.toEqual([
      { id: first.id, seq: 1 },
      { id: next.id, seq: 2 },
    ]);
  });

  it('keeps a sequence per fleet', async () => {
    const home = await aFleet();
    const away = await aFleet();
    const homeEvent = anEvent(home);
    const awayEvent = anEvent(away);

    await appendInOwnUnit(homeEvent);
    await appendInOwnUnit(awayEvent);

    await expect(sequenceOf(away)).resolves.toEqual([{ id: awayEvent.id, seq: 1 }]);
  });

  it('announces the fleet and the last number once the unit of work commits', async () => {
    const fleetId = await aFleet();
    const heard: unknown[] = [];
    const listener = listenForPendingDeliveries({
      databaseUrl,
      onNotice: () => undefined,
      onFleetEvent: (notice) => {
        heard.push(notice);
      },
    });
    try {
      await listener.listening;

      await createPrismaUnitOfWork(prisma).run(async (tx) => {
        await tx.events.append(anEvent(fleetId));
        await tx.events.append(anEvent(fleetId));
        return ok(undefined);
      });

      await expect.poll(() => heard).toEqual([{ fleetId, seq: 2 }]);
    } finally {
      await listener.close();
    }
  });

  it('announces nothing for a unit of work that refused', async () => {
    const fleetId = await aFleet();
    const heard: unknown[] = [];
    const listener = listenForPendingDeliveries({
      databaseUrl,
      onNotice: () => undefined,
      onFleetEvent: (notice) => {
        heard.push(notice);
      },
    });
    try {
      await listener.listening;

      await createPrismaUnitOfWork(prisma).run(async (tx) => {
        await tx.events.append(anEvent(fleetId));
        return refuse('SHIP_NOT_FOUND', 'refused after an event');
      });
      await appendInOwnUnit(anEvent(fleetId));

      await expect.poll(() => heard).toEqual([{ fleetId, seq: 1 }]);
    } finally {
      await listener.close();
    }
  });
});

describe('the event feed', () => {
  it('gives the last number of a fleet, and 0 before its first event', async () => {
    const fleetId = await aFleet();
    const feed = createPrismaFleetEventFeed(prisma);
    await expect(feed.lastSeq(fleetId)).resolves.toBe(0);

    await appendInOwnUnit(anEvent(fleetId));
    await appendInOwnUnit(anEvent(fleetId));

    await expect(feed.lastSeq(fleetId)).resolves.toBe(2);
  });

  it('gives up to the limit of events after a number, lowest first, as they were written', async () => {
    const fleetId = await aFleet();
    const events = [anEvent(fleetId), anEvent(fleetId), anEvent(fleetId), anEvent(fleetId)];
    for (const event of events) {
      await appendInOwnUnit(event);
    }
    await appendInOwnUnit(anEvent(await aFleet()));

    const read = await createPrismaFleetEventFeed(prisma).after(fleetId, { seq: 1, limit: 2 });

    expect(read).toEqual([
      { ...events[1], seq: 2 },
      { ...events[2], seq: 3 },
    ]);
  });

  it('gives an event its actor ship and what it concerns', async () => {
    const fleetId = await aFleet();
    const shipId = newId('ship');
    await prisma.ship.create({
      data: { id: shipId, fleetId, name: 'scout', type: 'reviewer', kind: 'agent', scopes: [], createdAt: new Date() },
    });
    const event: FleetEvent = {
      ...anEvent(fleetId),
      type: 'ShipCommissioned',
      actor: { kind: 'ship', shipId },
      shipId,
      details: { name: 'scout' },
    };
    await appendInOwnUnit(event);

    await expect(createPrismaFleetEventFeed(prisma).after(fleetId, { seq: 0, limit: 10 })).resolves.toEqual([
      { ...event, seq: 1 },
    ]);
  });
});
