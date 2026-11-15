/** Health reads and snapshot closes look up only the newly sent deliveries, not a fleet's message history (#1301). */
import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createPrismaHealthSnapshots } from '../src/adapters/prisma/health-snapshots.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { operatorCaller } from '../src/testing/fleet.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { seedScaleFleet } from './support/scale-fleet.js';

const EVENTS = 120_000;
const SENT = 5_000;
const SHIPS = 3_000;
const CHECKPOINT = 1_000_000 + 2 * (EVENTS - SENT) + 1;
const LAST_SEQ = 1_000_000 + 2 * EVENTS;
const HOUR_MS = 60 * 60 * 1000;
let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;

beforeAll(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(await seedScaleFleet(core));
  ({ fleetId } = argo);
}, 300_000);

afterAll(async () => {
  await core.close();
});

describe('health event replay on a busy fleet', () => {
  it.each([undefined, SENT])('looks up only newly sent deliveries and messages with event limit %s', async (limit) => {
    // Given 3,000 ships, 120,000 stored messages and 5,000 new sends after a checkpoint.
    const statements: { query: string; params: string }[] = [];
    const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => {
      statements.push({ query, params });
    });
    try {
      // When a health read (unlimited) or the snapshot closer (one page) replays those sends.
      const after = await createPrismaHealthSnapshots(client).eventsAfter(fleetId, { seq: CHECKPOINT, ...(limit === undefined ? {} : { limit }) });

      // Then all new sends retain their delivery facts, without scanning the stored history.
      expect(after.events).toHaveLength(SENT);
      expect(after.events[0]?.seq).toBe(CHECKPOINT + 1);
      expect(after.events.at(-1)?.seq).toBe(LAST_SEQ);
      expect(after.sent).toHaveLength(SENT);
      expect(new Set(after.sent.map((delivery) => delivery.deliveryId)).size).toBe(SENT);
      const reads = statements.filter(({ query }) => query.includes('SELECT DISTINCT unnest(') && query.includes('m.sender_ship_id'));
      expect(reads.length).toBeGreaterThan(0);
      for (const { query, params } of reads) {
        await assertIndexedPlan(core.prisma, { query, params });
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('closes the pending hour and answers fleet health and installation figures on the same busy fleet', async () => {
    // Given a closed hour before the newest sends, with the earlier deliveries finished.
    const snapshots = createPrismaHealthSnapshots(core.prisma);
    await core.prisma.healthSnapshot.deleteMany({ where: { fleetId } });
    await snapshots.write(fleetId, {
      hours: [{ hour: new Date(core.clock.now().getTime() - HOUR_MS), stuck: [], acknowledged: [] }],
      fold: { seq: CHECKPOINT, deliveries: [], turns: [] },
    });

    // When the scheduled close catches up and the affected use cases read the fleet.
    const errors: unknown[] = [];
    await core.useCases.closeHealthSnapshots((_fleetId, error) => { errors.push(error); });
    expect(errors).toEqual([]);
    const latest = await snapshots.latest(fleetId);
    const health = await core.useCases.readHealth(argo);
    const fleet = unwrap(await core.useCases.getInstallationFleet({ fleetId }));
    const fleets = await core.useCases.listInstallationFleets();

    // Then the checkpoint is current and every read counts the same 5,000 waiting deliveries.
    expect(latest?.hour).toEqual(core.clock.now());
    expect(latest?.fold.seq).toBe(LAST_SEQ);
    expect(latest?.fold.deliveries).toHaveLength(SENT);
    expect(health.stuckPerHour.at(-1)?.count).toBe(SENT);
    expect(fleet.shipCount).toBe(SHIPS);
    expect(fleet.health.stuckPerHour.at(-1)?.count).toBe(SENT);
    expect(fleets.find((row) => row.fleetId === fleetId)?.health.stuckPerHour.at(-1)?.count).toBe(SENT);
  });

});
