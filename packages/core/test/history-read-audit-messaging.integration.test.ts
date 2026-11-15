/**
 * The messaging reads on a fleet with a long history (holding scale, H3):
 * each request path's and pass's statements on messages, deliveries and
 * events through the Prisma adapters, by plan.
 */
import { idSchema, type DeliveryId, type LeaseId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaExchangeList, createPrismaExchangeRollups } from '../src/adapters/prisma/exchange-rollups.js';
import { createPrismaFleetEventFeed } from '../src/adapters/prisma/event-log.js';
import { readHarbourOf } from '../src/adapters/prisma/harbour.js';
import { createPrismaMeetingRepository } from '../src/adapters/prisma/meetings.js';
import { createPrismaDeliveryRepository, createPrismaMessageRepository } from '../src/adapters/prisma/messaging.js';
import { shipFilterCondition } from '../src/adapters/prisma/registry.js';
import { createPrismaScheduleRepository } from '../src/adapters/prisma/schedules.js';
import { readShipCounts } from '../src/adapters/prisma/ship-counts.js';
import type { ReadReach } from '../src/domain/registry/read-reach.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import type { PrismaClient } from '../src/adapters/prisma/client.js';
import { SCALE_MESSAGES, SCALE_SHIPS, seedScaleHistory, type ScaleHistory } from './support/scale-history.js';
import { plansOf, scansIn } from './support/statement-plans.js';

let core: PostgresCore;
let scale: ScaleHistory;

beforeAll(async () => {
  core = await createPostgresCore();
  scale = await seedScaleHistory(core);
}, 600_000);

afterAll(async () => {
  await core.close();
});

/** The tables a read's statements scan sequentially, one entry per scan: empty when it holds. */
async function scansOf(read: (client: PrismaClient) => Promise<unknown>): Promise<string[]> {
  const plans = await plansOf(core, ({ client }) => read(client));
  expect(plans.length).toBeGreaterThan(0);
  return scansIn(plans).flatMap(({ tables }) => tables);
}

const OTHERS = SCALE_SHIPS - 1;
const EVERY: ReadReach = { kind: 'every' };

describe('the messaging reads on a fleet with 120,000 messages', () => {
  const messages = (client: PrismaClient) => createPrismaMessageRepository(client);
  const deliveries = (client: PrismaClient) => createPrismaDeliveryRepository(client, createPrismaExchangeRollups(client));
  /** Delivery i goes from ship 1 + i % 2999 to ship 1 + (i + 7) % 2999. */
  const senderIndex = (i: number) => 1 + (i % OTHERS);
  const recipientIndex = (i: number) => 1 + ((i + 7) % OTHERS);
  /** An open delivery received under its recipient's open lease, and one still pending. */
  const received = SCALE_MESSAGES - 10;
  const pending = SCALE_MESSAGES - 9;
  const old = SCALE_MESSAGES / 2;
  const delivery = (i: number) => idSchema('delivery').parse(scale.deliveryId(i));
  const message = (i: number) => idSchema('message').parse(scale.messageId(i));
  const leaseOf = (shipIndex: number): LeaseId => idSchema('lease').parse('lse_' + String(2 * shipIndex).padStart(26, '0'));
  const noneExcluded: DeliveryId[] = [];
  const receiver = (i: number) => ({ fleetId: scale.fleetId, shipId: scale.shipId(recipientIndex(i)), type: 'agent', leaseId: leaseOf(recipientIndex(i)), limit: 10, excluding: noneExcluded });

  it('ship.send reads its idempotency key through its index', async () => {
    const key = { fleetId: scale.fleetId, senderShipId: scale.shipId(senderIndex(old)), idempotencyKey: `seed-${old}` };
    expect(await scansOf((client) => messages(client).findByIdempotencyKey(key))).toEqual([]);
  });

  it('ship.sentMessage reads one message through its index', async () => {
    expect(await scansOf((client) => messages(client).find(scale.fleetId, message(old)))).toEqual([]);
  });

  it('fleet.retire pages a ship\'s open questions through their indexes', async () => {
    expect(await scansOf((client) => messages(client).listOpenQuestionsOf(scale.fleetId, { shipId: scale.shipId(42), limit: 20 }))).toEqual([]);
  });

  it('ship.inbox counts what a crew can receive through its indexes', async () => {
    const { fleetId, shipId, type, leaseId } = receiver(received);
    expect(await scansOf((client) => deliveries(client).countReceivable({ fleetId, shipId, type, leaseId }))).toEqual([]);
  });

  it('ship.receive and ship.pushReceive claim deliveries through their indexes', async () => {
    expect(await scansOf((client) => deliveries(client).findClaimableForUpdate(receiver(received)))).toEqual([]);
  });

  it('ship.receive claims the replies to one message through their indexes', async () => {
    expect(await scansOf((client) => deliveries(client).findClaimableForUpdate({ ...receiver(received), inReplyTo: message(received) }))).toEqual([]);
  });

  it('ship.pushReceive claims deliveries skipping the handed ones through their indexes', async () => {
    expect(await scansOf((client) => deliveries(client).findClaimableForUpdate({ ...receiver(received), shouldSkipHanded: true }))).toEqual([]);
  });

  it.each(['older', 'newer'] as const)('ship.exchange pages an exchange %s through its indexes', async (toward) => {
    const query = { fleetId: scale.fleetId, shipId: scale.shipId(recipientIndex(old)), otherShipId: scale.shipId(senderIndex(old)), toward, from: delivery(old), limit: 20 };
    expect(await scansOf((client) => deliveries(client).findExchangePage(query))).toEqual([]);
  });

  it('ship.exchange pages an exchange from its start through its indexes', async () => {
    const query = { fleetId: scale.fleetId, shipId: scale.shipId(recipientIndex(old)), otherShipId: scale.shipId(senderIndex(old)), toward: 'older' as const, limit: 20 };
    expect(await scansOf((client) => deliveries(client).findExchangePage(query))).toEqual([]);
  });

  it('ship.ackUpTo locks the unacknowledged deliveries of an exchange through their indexes', async () => {
    const query = { fleetId: scale.fleetId, shipId: scale.shipId(recipientIndex(received)), otherShipId: scale.shipId(senderIndex(received)), upTo: delivery(received) };
    expect(await scansOf((client) => deliveries(client).findUnacknowledgedUpToForUpdate(query))).toEqual([]);
  });

  it('ship.record pages a ship\'s record through its indexes', async () => {
    expect(await scansOf((client) => deliveries(client).findRecordPage({ fleetId: scale.fleetId, shipId: scale.shipId(42), limit: 20 }))).toEqual([]);
  });

  it('ship.record pages a ship\'s record after a cursor through its indexes', async () => {
    expect(await scansOf((client) => deliveries(client).findRecordPage({ fleetId: scale.fleetId, shipId: scale.shipId(recipientIndex(old)), cursor: delivery(old), limit: 20 }))).toEqual([]);
  });

  it('ship.delivery locks and reads one delivery through its index', async () => {
    expect(await scansOf((client) => deliveries(client).findForUpdate(scale.fleetId, delivery(old)))).toEqual([]);
  });

  it('ship.delivery reads one delivery through its index', async () => {
    expect(await scansOf((client) => deliveries(client).find(scale.fleetId, delivery(old)))).toEqual([]);
  });

  it('ship.send reads the delivery of a message that reached a ship through its indexes', async () => {
    const reached = { messageId: message(old), shipId: scale.shipId(recipientIndex(old)) };
    expect(await scansOf((client) => deliveries(client).findOfMessageReaching(scale.fleetId, reached))).toEqual([]);
  });

  it('fleet.ping reads a ship\'s open ping through its indexes', async () => {
    expect(await scansOf((client) => deliveries(client).findOpenPing(scale.fleetId, scale.shipId(recipientIndex(pending))))).toEqual([]);
  });

  it('ship.receive stores a delivery\'s change through its index', async () => {
    expect(
      await scansOf(async (client) => {
        const repository = deliveries(client);
        const found = await repository.find(scale.fleetId, delivery(received));
        if (found === undefined) {
          throw new Error('The seeded delivery is missing');
        }
        await repository.update(found);
      }),
    ).toEqual([]);
  });

  it('fleet.markRead marks a delivery read and unread through its index', async () => {
    expect(
      await scansOf(async (client) => {
        const repository = deliveries(client);
        await repository.markRead({ fleetId: scale.fleetId, deliveryId: delivery(old), at: core.clock.now() });
        await repository.markUnread({ fleetId: scale.fleetId, deliveryId: delivery(old) });
      }),
    ).toEqual([]);
  });

  it('ship.meeting pages a meeting\'s contributions through their index', async () => {
    const meetingId = idSchema('meeting').parse('mtg_' + '1'.padStart(26, '0'));
    expect(await scansOf((client) => createPrismaMeetingRepository(client).contributions(scale.fleetId, { meetingId, limit: 20 }))).toEqual([]);
  });

  it('ship.meeting pages a meeting\'s contributions after a cursor through their index', async () => {
    const meetingId = idSchema('meeting').parse('mtg_' + '1'.padStart(26, '0'));
    expect(await scansOf((client) => createPrismaMeetingRepository(client).contributions(scale.fleetId, { meetingId, cursor: message(old), limit: 20 }))).toEqual([]);
  });

  it('ship.exchanges pages a ship\'s list of exchanges through its rollup', async () => {
    expect(await scansOf((client) => createPrismaExchangeList(client).page({ fleetId: scale.fleetId, shipId: scale.shipId(42), limit: 20 }))).toEqual([]);
  });

  it('ship.exchanges pages a ship\'s list of exchanges after a cursor through its rollup', async () => {
    expect(await scansOf((client) => createPrismaExchangeList(client).page({ fleetId: scale.fleetId, shipId: scale.shipId(42), cursor: message(old), limit: 20 }))).toEqual([]);
  });

  it('fleet.events and fleet.follow read the events after a number through their index', async () => {
    const seq = Number(scale.lastSeq) - 100;
    expect(await scansOf((client) => createPrismaFleetEventFeed(client).after(scale.fleetId, { seq, limit: 100 }))).toEqual([]);
  });

  it('fleet.harbour reads the first page and the numbers through their indexes', async () => {
    expect(await scansOf((client) => readHarbourOf(client, { fleetId: scale.fleetId, read: { reach: EVERY, filter: {}, limit: 20 } }))).toEqual([]);
  });

  it('fleet.harbour reads named ships through their indexes', async () => {
    const shipIds: ShipId[] = [scale.shipId(1), scale.shipId(2)];
    expect(await scansOf((client) => readHarbourOf(client, { fleetId: scale.fleetId, read: { reach: EVERY, filter: {}, shipIds } }))).toEqual([]);
  });

  it('fleet.shipCounts counts the ships through their indexes', async () => {
    expect(await scansOf((client) => readShipCounts(client, { fleetId: scale.fleetId, reach: EVERY, selected: shipFilterCondition({}, EVERY) }))).toEqual([]);
  });

  it('the schedule pass counts what a schedule sent through its index', async () => {
    const scheduleId = idSchema('schedule').parse('sch_' + '1'.padStart(26, '0'));
    expect(await scansOf((client) => createPrismaScheduleRepository(client).sentCount(scale.fleetId, scheduleId))).toEqual([]);
  });
});
