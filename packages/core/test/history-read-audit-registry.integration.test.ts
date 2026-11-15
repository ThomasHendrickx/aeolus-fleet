/**
 * The registry, installation and health reads on a fleet with a long history
 * (holding scale, H3): each request path's statements on messages, deliveries
 * and events, by plan.
 */
import { idSchema, STUCK_TREND_HOURS } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaExchangeRollups } from '../src/adapters/prisma/exchange-rollups.js';
import { createPrismaHealthRecords } from '../src/adapters/prisma/health.js';
import { createPrismaHealthSnapshots } from '../src/adapters/prisma/health-snapshots.js';
import { createPrismaInstallationFleets } from '../src/adapters/prisma/installation.js';
import { createPrismaFleetListing, createPrismaFleetRepository, createPrismaInFlightDeliveries, createPrismaShipRepository } from '../src/adapters/prisma/registry.js';
import { messageWindow } from '../src/domain/registry/installation-fleet.js';
import type { ReadReach } from '../src/domain/registry/read-reach.js';
import type { UseCases } from '../src/wiring.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { seedScaleHistory, type ScaleHistory } from './support/scale-history.js';
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

const EVERY: ReadReach = { kind: 'every' };
const HOUR_MS = 60 * 60 * 1000;

/** The statements `read` runs on the history tables that scan one of them, by table. */
async function scansOf(read: (ports: { client: PrismaClient; useCases: UseCases }) => Promise<unknown>): Promise<string[]> {
  const plans = await plansOf(core, read);
  expect(plans.length).toBeGreaterThan(0);
  return scansIn(plans).flatMap(({ tables }) => tables);
}

/** Thrown to roll a write back: the fixture is shared, so a write is only ever explained. */
class RolledBack extends Error {}

/** Runs `write` in a transaction that always rolls back. */
async function rolledBack(client: PrismaClient, write: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<unknown>): Promise<void> {
  await expect(
    client.$transaction(async (tx) => {
      await write(tx);
      throw new RolledBack('roll back');
    }, { timeout: 120_000 }),
  ).rejects.toBeInstanceOf(RolledBack);
}

describe('the registry reads on a fleet with 120,000 messages', () => {
  const page = { limit: 50, reach: EVERY };

  it.each(['ship', 'status', 'report', 'runsOn', 'seen', 'requested'] as const)('fleet.list pages the fleet\'s ships sorted by %s through their indexes', async (column) => {
    expect(await scansOf(({ client }) => createPrismaFleetListing(client).ships(scale.fleetId, { ...page, filter: {}, sort: { column, direction: 'ascending' } }))).toEqual([]);
  });

  it('fleet.list pages the fleet\'s ships in the default order through their indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaFleetListing(client).ships(scale.fleetId, { ...page, filter: {} }))).toEqual([]);
  });

  it('fleet.list pages the ships filtered by crew request through their indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaFleetListing(client).ships(scale.fleetId, { ...page, filter: { crewRequest: ['none', 'needsCrew'] } }))).toEqual([]);
  });

  it.each(['withTrierarchs', 'withoutTrierarchs'] as const)('fleet.list pages the ships that need a crew %s through their indexes', async (needsCrew) => {
    expect(await scansOf(({ client }) => createPrismaFleetListing(client).ships(scale.fleetId, { ...page, filter: { needsCrew } }))).toEqual([]);
  });

  it('fleet.ship and fleet.listedShip read one ship through its indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaFleetListing(client).ship(scale.fleetId, scale.shipId(42)))).toEqual([]);
  });

  it('fleet.shipCounts counts the fleet\'s ships through their indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaFleetListing(client).counts(scale.fleetId, { reach: EVERY, filter: {} }))).toEqual([]);
  });

  it.each([{ crewRequest: ['none', 'needsCrew'] as const }, { needsCrew: 'withTrierarchs' as const }, { needsCrew: 'withoutTrierarchs' as const }])(
    'fleet.shipCounts counts the ships filtered by %o through their indexes',
    async (filter) => {
      expect(await scansOf(({ client }) => createPrismaFleetListing(client).counts(scale.fleetId, { reach: EVERY, filter }))).toEqual([]);
    },
  );

  it('fleet.ship counts a ship\'s deliveries through their indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaFleetListing(client).deliveryCounts(scale.fleetId, scale.shipId(42)))).toEqual([]);
  });

  it('fleet.lastNamedOwner finds the commissioner\'s last named owner through the events indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaShipRepository(client).findLastNamedOwner(scale.fleetId, scale.shipId(42)))).toEqual([]);
  });

  it('fleet.release returns a lease\'s claims to pending through the deliveries indexes', async () => {
    const leaseId = idSchema('lease').parse('lse_' + String(2 * 42).padStart(26, '0'));
    expect(
      await scansOf(({ client }) =>
        rolledBack(client, (tx) => createPrismaInFlightDeliveries(tx, createPrismaExchangeRollups(tx)).returnToPending(scale.fleetId, leaseId)),
      ),
    ).toEqual([]);
  });

  it('fleet.retire abandons a ship\'s pending deliveries through the deliveries indexes', async () => {
    expect(
      await scansOf(({ client }) =>
        rolledBack(client, (tx) => createPrismaInFlightDeliveries(tx, createPrismaExchangeRollups(tx)).abandonPendingTo(scale.fleetId, scale.shipId(35))),
      ),
    ).toEqual([]);
  });
});

describe('the installation reads on a fleet with 120,000 messages', () => {
  it('installation.fleets.list reads the fleets\' history facts through the indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaInstallationFleets(client).list(messageWindow(core.clock.now())))).toEqual([]);
  });

  it('installation.fleets.get reads one fleet\'s history facts through the indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaInstallationFleets(client).find(scale.fleetId, messageWindow(core.clock.now())))).toEqual([]);
  });
});

describe('the health reads on a fleet with 120,000 messages', () => {
  const since = () => new Date(core.clock.now().getTime() - STUCK_TREND_HOURS * HOUR_MS);

  it('fleet.health, fleet.stuck and fleet.acknowledged read the fallback before any snapshot through the indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaHealthRecords(client).read(scale.fleetId, since()))).toEqual([]);
  });

  it('fleet.acknowledged reads the deliveries acknowledged since an hour through the indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaHealthRecords(client).acknowledged(scale.fleetId, new Date(core.clock.now().getTime() - 24 * HOUR_MS)))).toEqual([]);
  });

  describe('before any snapshot', () => {
    beforeAll(async () => {
      await core.prisma.healthSnapshot.deleteMany({ where: { fleetId: scale.fleetId } });
    });

    it('fleet.health reads before any snapshot through the indexes', async () => {
      expect(await scansOf(({ useCases }) => useCases.readHealth(scale.argo))).toEqual([]);
    });

    it('fleet.stuck, fleet.stuckCount, fleet.stuckSummary and fleet.stuckHistory read before any snapshot through the indexes', async () => {
      expect(
        await scansOf(async ({ useCases }) => {
          await useCases.readStuck(scale.argo, {});
          await useCases.readStuckCount(scale.argo);
          await useCases.readStuckSummary(scale.argo);
          await useCases.readStuckHistory(scale.argo);
        }),
      ).toEqual([]);
    }, 120_000);

    it('fleet.acknowledged reads before any snapshot through the indexes', async () => {
      expect(await scansOf(({ useCases }) => useCases.readAcknowledged(scale.argo))).toEqual([]);
    });
  });

  describe('after a snapshot', () => {
    const recentSeq = () => Number(scale.lastSeq) - 300;

    beforeAll(async () => {
      const hour = new Date(Math.floor(core.clock.now().getTime() / HOUR_MS) * HOUR_MS - HOUR_MS);
      await core.prisma.healthSnapshot.deleteMany({ where: { fleetId: scale.fleetId } });
      await createPrismaHealthSnapshots(core.prisma).write(scale.fleetId, { hours: [{ hour, stuck: [], acknowledged: [] }], fold: { seq: recentSeq(), deliveries: [], turns: [] } });
    });

    afterAll(async () => {
      await core.prisma.healthSnapshot.deleteMany({ where: { fleetId: scale.fleetId } });
    });

    it('fleet.health reads the events after a recent seq through their indexes', async () => {
      expect(await scansOf(({ client }) => createPrismaHealthSnapshots(client).eventsAfter(scale.fleetId, { seq: recentSeq() }))).toEqual([]);
    });

    it('fleet.health reads after a snapshot through the indexes', async () => {
      expect(await scansOf(({ useCases }) => useCases.readHealth(scale.argo))).toEqual([]);
    });

    it('fleet.stuck, fleet.stuckCount, fleet.stuckSummary and fleet.stuckHistory read after a snapshot through the indexes', async () => {
      expect(
        await scansOf(async ({ useCases }) => {
          await useCases.readStuck(scale.argo, {});
          await useCases.readStuckCount(scale.argo);
          await useCases.readStuckSummary(scale.argo);
          await useCases.readStuckHistory(scale.argo);
        }),
      ).toEqual([]);
    });

    it('fleet.acknowledged reads after a snapshot through the indexes', async () => {
      expect(await scansOf(({ useCases }) => useCases.readAcknowledged(scale.argo))).toEqual([]);
    });
  });
});

describe('the fleet delete on a fleet with 120,000 messages', () => {
  // Scans the fleet's history: issue to file.
  it('installation.fleets.delete scans the fleet\'s history by design', async () => {
    // Rolled back: the fleet and its history stay for the other tests.
    const scans = await scansOf(({ client }) => rolledBack(client, (tx) => createPrismaFleetRepository(tx).delete(scale.fleetId)));
    expect(scans).toEqual(['events', 'deliveries', 'messages', 'messages']);
  }, 120_000);
});
