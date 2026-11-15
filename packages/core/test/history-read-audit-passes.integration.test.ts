/**
 * The background passes and the migrations on a fleet with a long history
 * (holding scale, decisions 4 and 5): each statement a pass task or step runs
 * on messages, deliveries or events, by plan. Migrations are planned, never run.
 */
import { readFileSync } from 'node:fs';

import { idSchema } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db, PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaHealthSnapshots } from '../src/adapters/prisma/health-snapshots.js';
import { createPrismaHistoryPruner } from '../src/adapters/prisma/history-pruner.js';
import { createPrismaOverdueDeliveryRepository, createPrismaPushedCrews } from '../src/adapters/prisma/overdue.js';
import { createPrismaScheduleRepository } from '../src/adapters/prisma/schedules.js';
import { createPrismaFleetSealingRepository } from '../src/adapters/prisma/sealings.js';
import { overdueDelivery } from '../src/domain/messaging/overdue.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { seedScaleHistory, type ScaleHistory } from './support/scale-history.js';
import { plansOf, scansIn, sequentialScansOf } from './support/statement-plans.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIGRATIONS = new URL('../src/adapters/prisma/migrations/', import.meta.url);

let core: PostgresCore;
let scale: ScaleHistory;

beforeAll(async () => {
  core = await createPostgresCore();
  scale = await seedScaleHistory(core);
}, 600_000);

afterAll(async () => {
  await core.close();
});

/** The tables the statements `read` runs on the history tables scan sequentially, one entry per scan. */
async function scansOf(read: Parameters<typeof plansOf>[1]): Promise<string[]> {
  const plans = await plansOf(core, read);
  expect(plans.length).toBeGreaterThan(0);
  return scansIn(plans).flatMap(({ tables }) => tables);
}

/** Thrown to roll a transaction back after its statements ran. */
class RolledBack extends Error {}

/** Runs `write` in a transaction of `client` that always rolls back, so its statements run and leave the fixture as it was. */
async function rolledBack(client: PrismaClient, write: (tx: Db) => Promise<unknown>): Promise<void> {
  await client
    .$transaction(
      async (tx) => {
        await write(tx);
        throw new RolledBack();
      },
      { timeout: 120_000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) {
        throw error;
      }
    });
}

/** The UPDATE statements of a migration, each as one statement without its comments. */
function updatesOf(migration: string): string[] {
  const sql = readFileSync(new URL(`${migration}/migration.sql`, MIGRATIONS), 'utf8');
  const statements = sql
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((statement) => statement.trim().replace(/;$/, ''))
    .filter((statement) => /^UPDATE\b/i.test(statement));
  expect(statements.length).toBeGreaterThan(0);
  return statements;
}

/** The sequential scans of the history tables in the plans of the migration's UPDATE statements, never run. */
async function migrationScans(migration: string): Promise<string[]> {
  const scans: string[] = [];
  for (const statement of updatesOf(migration)) {
    const rows = await core.prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>('EXPLAIN ' + statement);
    scans.push(...sequentialScansOf(rows.map((row) => row['QUERY PLAN']).join('\n')));
  }
  return scans;
}

describe('the maintenance pass on a fleet with 120,000 messages', () => {
  it('the overdue clock finds the deliveries waiting for pushed crews through their indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaPushedCrews(client).waiting(scale.fleetId))).toEqual([]);
  });

  it('the overdue clock tells a delivery through its indexes', async () => {
    const waiting = await createPrismaPushedCrews(core.prisma).waiting(scale.fleetId);
    const found = waiting.map((crew) => ({ crew, overdue: overdueDelivery(crew, core.clock.now()) })).find(({ overdue }) => overdue !== undefined);
    if (found?.overdue === undefined) {
      throw new Error('The scale history must hold an overdue delivery');
    }
    const { overdue } = found;
    expect(await scansOf(({ client }) => createPrismaOverdueDeliveryRepository(client).tell(overdue, core.clock.now()))).toEqual([]);
  });

  it('the overdue clock pass tells its fleets through their indexes', async () => {
    expect(await scansOf(({ useCases }) => useCases.tellOverdueDeliveries())).toEqual([]);
  });

  it('the snapshot close reads the first snapshot\'s base through its indexes', async () => {
    const hour = new Date(Math.floor(core.clock.now().getTime() / HOUR_MS) * HOUR_MS - 167 * HOUR_MS);
    expect(await scansOf(({ client }) => createPrismaHealthSnapshots(client).baseAt(scale.fleetId, hour))).toEqual([]);
  });

  it('the snapshot close reads a page of 5,000 events after a seq through their indexes', async () => {
    const seq = Number(scale.lastSeq) - 20_000;
    expect(await scansOf(({ client }) => createPrismaHealthSnapshots(client).eventsAfter(scale.fleetId, { seq, limit: 5_000 }))).toEqual([]);
  });

  it('the pruning pass reads a batch of candidates through their indexes', async () => {
    await core.prisma.$executeRaw`UPDATE fleets SET retention_set = true, retention_days = 30 WHERE id = ${scale.fleetId}`;
    const cutoff = new Date(core.clock.now().getTime() - 30 * DAY_MS);
    expect(await scansOf(({ client }) => createPrismaHistoryPruner(client).candidates(scale.fleetId, { cutoff, after: null, limit: 500 }))).toEqual([]);
  });

  it('the pruning pass reads the events of ended meetings through their indexes', async () => {
    const cutoff = new Date(core.clock.now().getTime() - 30 * DAY_MS);
    expect(await scansOf(({ client }) => createPrismaHistoryPruner(client).meetingEvents(scale.fleetId, { cutoff, limit: 500 }))).toEqual([]);
  });

  it('the pruning pass reads the rows that go by age through their indexes', async () => {
    const cutoff = new Date(core.clock.now().getTime() - 30 * DAY_MS);
    const messageIds = await createPrismaHistoryPruner(core.prisma).candidates(scale.fleetId, { cutoff, after: null, limit: 500 });
    expect(await scansOf(({ client }) => createPrismaHistoryPruner(client).agedRows(scale.fleetId, { cutoff, messageIds: messageIds.map(({ id }) => id), limit: 500 }))).toEqual([]);
  });

  it('the pruning pass lets a batch go through the indexes of its messages, deliveries and events', async () => {
    const cutoff = new Date(core.clock.now().getTime() - 30 * DAY_MS);
    const pruner = createPrismaHistoryPruner(core.prisma);
    const candidates = await pruner.candidates(scale.fleetId, { cutoff, after: null, limit: 500 });
    const aged = await pruner.agedRows(scale.fleetId, { cutoff, messageIds: candidates.map(({ id }) => id), limit: 500 });
    const meetingEventIds = await pruner.meetingEvents(scale.fleetId, { cutoff, limit: 500 });
    const set = { ...aged, messageIds: candidates.map(({ id }) => id), meetingEventIds, shipIds: [], removedAt: core.clock.now() };
    expect(await scansOf(({ client }) => rolledBack(client, (tx) => createPrismaHistoryPruner(tx).go(scale.fleetId, set)))).toEqual([]);
  });

  // Scans the fleet's history: issue to file.
  it('fleet.turnOnSealing asks whether the fleet stores a plain payload by scanning messages', async () => {
    expect(await scansOf(({ client }) => createPrismaFleetSealingRepository(client).storesPlainPayload(scale.fleetId))).toEqual(['messages']);
  });

  // Scans the fleet's history: issue to file.
  it('fleet.turnOnSealing counts the fleet\'s plain payloads by scanning messages', async () => {
    expect(await scansOf(({ client }) => createPrismaFleetSealingRepository(client).plainPayloadCount(scale.fleetId))).toEqual(['messages']);
  });

  it('the sealing pass reads a batch of plain payloads through its indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaFleetSealingRepository(client).plainPayloads(scale.fleetId, { after: null, limit: 500 }))).toEqual([]);
  });

  it('the sealing pass stores a batch of sealed payloads through its indexes', async () => {
    const plain = await createPrismaFleetSealingRepository(core.prisma).plainPayloads(scale.fleetId, { after: null, limit: 500 });
    const dataKeyId = idSchema('dataKey').parse('dky_' + '0'.repeat(26));
    const sealed = {
      messages: plain.messages.map(({ id, requestHash }) => ({ id, requestHash, payload: { plainBytes: 5, sealed: { dataKeyId, nonce: new Uint8Array(12), ciphertext: new Uint8Array(21) } } })),
      schedules: [],
    };
    expect(
      await scansOf(({ client }) =>
        rolledBack(client, async (tx) => {
          await tx.dataKey.create({ data: { id: dataKeyId, fleetId: scale.fleetId, wrappedByCompanyKey: new Uint8Array(1), checkValue: new Uint8Array(1), createdAt: core.clock.now(), isCurrent: true } });
          await createPrismaFleetSealingRepository(tx).sealPayloads(scale.fleetId, sealed);
        }),
      ),
    ).toEqual([]);
  });

  it('the schedule pass counts the messages a schedule sent through its indexes', async () => {
    expect(await scansOf(({ client }) => createPrismaScheduleRepository(client).sentCount(scale.fleetId, idSchema('schedule').parse('sch_' + '0'.repeat(26))))).toEqual([]);
  });

  it('the snapshot close pass closes the fleet\'s hours through their indexes', async () => {
    expect(await scansOf(({ useCases }) => useCases.closeHealthSnapshots((_, error) => { throw error; }))).toEqual([]);
  });

  it('the pruning pass prunes the fleet\'s finished history through its indexes', async () => {
    expect(await scansOf(({ useCases }) => useCases.pruneHistory((_, error) => { throw error; }))).toEqual([]);
  });
});

describe('the migrations not yet released on a fleet with 120,000 messages', () => {
  // Scans the fleet's history: issue to file. One scan of messages for each of its two UPDATE statements.
  it('20261115090000_messages_asked_answered_question_id fills the question ids by scanning messages twice', async () => {
    expect(await migrationScans('20261115090000_messages_asked_answered_question_id')).toEqual(['messages', 'messages']);
  });

  // Scans the fleet's history: issue to file.
  it('20261115100000_unseen_plain_messages counts the unseen plain messages by scanning messages', async () => {
    expect(await migrationScans('20261115100000_unseen_plain_messages')).toEqual(['messages']);
  });
});
