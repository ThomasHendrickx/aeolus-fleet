import { afterAll, beforeAll, expect, it } from 'vitest';

import { createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { ok } from '../src/domain/shared/result.js';
import { createPrismaEventLog } from '../src/adapters/prisma/event-log.js';
import { createPrismaInstallationFleets } from '../src/adapters/prisma/installation.js';
import { projectJourneyEvents, journeyPageStatement, journeyChangesStatement, createPrismaInstallationJourneyReads, createPrismaJourneyActivityExpiry } from '../src/adapters/prisma/fleet-journeys.js';
import { journeySourceFact } from '../src/adapters/prisma/journey-source-facts.js';
import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { messageWindow } from '../src/domain/registry/installation-fleet.js';
import { createIdGenerator, idSchema } from '@aeolus-fleet/common';
import { operatorCaller } from '../src/testing/fleet.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';

let core: PostgresCore;
const ids = createIdGenerator();

beforeAll(async () => { core = await createPostgresCore(); });
afterAll(async () => { await core.close(); });

it('reads compact fleet pages, changes and source metadata through indexes at long-history volume', async () => {
  // Given a fleet with history larger than the journey resources and an actual query-recording client.
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'large history' }));
  await core.prisma.$executeRaw`INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_seed' || i, ${fleet.fleetId}, ${fleet.operatorShipId}, 'ship', ${fleet.operatorShipId}, 'x', 'text/plain', 'seed-' || i, 'h', ${core.clock.now()} FROM generate_series(1, 20000) i`;
  await core.prisma.$executeRaw`INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_seed' || i, ${fleet.fleetId}, 'msg_seed' || i, ${fleet.operatorShipId}, ${fleet.operatorShipId}, 'pending', ${core.clock.now()} FROM generate_series(1, 20000) i`;
  await core.prisma.$executeRaw`INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, details, seq)
    SELECT 'evt_seed' || i, ${fleet.fleetId}, 'MessageAccepted', ${core.clock.now()}, 'system', '{}'::jsonb, 1000000 + i FROM generate_series(1, 20000) i`;
  await core.prisma.$executeRaw`ANALYZE messages, deliveries, events, fleet_journeys, installation_journey_changes`;
  await core.prisma.$executeRaw`INSERT INTO leases(id, fleet_id, ship_id, location, started_at, ended_at)
    SELECT 'lse_seed' || i, ${fleet.fleetId}, ${fleet.operatorShipId}, 'CLOUD', ${core.clock.now()}::timestamptz - i * interval '1 hour', ${core.clock.now()}::timestamptz - i * interval '1 hour' + interval '1 minute' FROM generate_series(1, 20000) i`;
  await core.prisma.$executeRaw`ANALYZE leases`;
  const sent = unwrap(await core.useCases.sendMessage(operatorCaller(fleet), { selector: { kind: 'ship', shipId: fleet.operatorShipId }, payload: 'not selected by journey reads', idempotencyKey: 'plan-source' }));
  const delivery = await core.prisma.delivery.findFirstOrThrow({ where: { fleetId: fleet.fleetId, messageId: sent.messageId } });
  await core.prisma.$executeRaw`INSERT INTO fleets(id, name, created_at)
    SELECT 'flt_' || lpad(i::text, 26, '0'), 'projected', '2020-01-01'::timestamptz FROM generate_series(1, 3000) i`;
  await core.prisma.$executeRaw`INSERT INTO fleet_journeys(fleet_id, created_at, coverage_from, activity_expires_at)
    SELECT id, created_at, ${core.clock.now()}, CASE WHEN id = 'flt_00000000000000000000000001' THEN '2020-04-01'::timestamptz ELSE NULL END FROM fleets WHERE name = 'projected'`;
  await core.prisma.$executeRaw`INSERT INTO installation_journey_changes(resource_id, seq, is_deleted)
    SELECT fleet_id, 100000 + row_number() OVER(ORDER BY fleet_id), false FROM fleet_journeys WHERE created_at = '2020-01-01'::timestamptz`;
  await core.prisma.$executeRaw`UPDATE installation_journey_clock SET seq = 103000 WHERE id = 1`;
  await core.prisma.$executeRaw`ANALYZE fleet_journeys, installation_journey_changes`;
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => statements.push({ query, params }));
  try {
    // When real projection, source, get, page and change adapters read this fleet.
    const event = { id: ids('event'), fleetId: fleet.fleetId, type: 'ShipClaimed' as const, occurredAt: core.clock.now(), actor: { kind: 'system' as const }, shipId: fleet.operatorShipId, details: {} };
    await journeySourceFact(client, event);
    await journeySourceFact(client, { ...event, type: 'MessageAccepted', messageId: sent.messageId, deliveryId: idSchema('delivery').parse(delivery.id) });
    await createPrismaInstallationJourneyReads(client).page();
    await createPrismaInstallationJourneyReads(client).changes(0n);
    await createPrismaJourneyActivityExpiry(client).expired(core.clock.now(), 20);
    await createPrismaInstallationFleets(client).find(fleet.fleetId, messageWindow(core.clock.now()));
    await createPrismaFleetRepository(client).find(fleet.fleetId);
    const log = createPrismaEventLog(client, core.clock);
    await log.append(event);
    await log.flush();
    await createPrismaUnitOfWork(client, core.clock).run(async (tx) => ok(await tx.fleets.find(fleet.fleetId)));
    // Then history lookups stay indexed and the fleet resources read compact projections only.
    for (const statement of statements.filter((statement) => /^\s*(SELECT|UPDATE)/.test(statement.query) && !statement.query.includes('pg_notify'))) {
      const plan = await assertIndexedPlan(core.prisma, statement);
      if (statement.query.includes('FROM leases l')) expect(plan).toContain('leases_fleet_id_ship_id_started_at_id_idx');
      if (statement.query.includes('FOR UPDATE SKIP LOCKED')) expect(plan).toContain('fleet_journeys_activity_expires_at_fleet_id_idx');
    }
    const page = await assertIndexedPlan(core.prisma, journeyPageStatement({ createdAt: new Date('2019-01-01'), fleetId: fleet.fleetId }));
    const changes = await assertIndexedPlan(core.prisma, journeyChangesStatement(0n));
    expect(page).toContain('fleet_journeys_created_at_fleet_id_idx');
    expect(changes).toContain('installation_journey_changes_seq_key');
    expect(page).not.toContain('messages');
    expect(changes).not.toContain('messages');
    expect(statements.some((statement) => statement.query.includes('fleet_journeys'))).toBe(true);
  } finally { await client.$disconnect(); }
});

it('delivery events in one fleet do not wait for another fleet and fan-out qualification has a constant statement budget', async () => {
  // Given thirty deliveries that cannot change customer milestones, and another fleet holding the change clock.
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'delivery budget' }));
  const sent = unwrap(await core.useCases.sendMessage(operatorCaller(fleet), { selector: { kind: 'ship', shipId: fleet.operatorShipId }, payload: 'system', idempotencyKey: 'budget' }));
  const events = Array.from({ length: 30 }, () => ({ id: ids('event'), fleetId: fleet.fleetId, type: 'MessageAccepted', occurredAt: core.clock.now(), actor: { kind: 'ship' as const, shipId: fleet.operatorShipId }, shipId: ids('ship'), messageId: sent.messageId, deliveryId: ids('delivery'), details: {} }));
  await core.prisma.ship.createMany({ data: events.map((event, index) => ({ id: event.shipId, fleetId: fleet.fleetId, name: `recipient-${index}`, type: 'reader', kind: 'agent', scopes: [], createdAt: core.clock.now() })) });
  await core.prisma.delivery.createMany({ data: events.map((event) => ({ id: event.deliveryId, fleetId: fleet.fleetId, messageId: sent.messageId, senderShipId: fleet.operatorShipId, recipientShipId: event.shipId, state: 'pending', createdAt: core.clock.now() })) });
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => statements.push({ query, params }));
  try {
    // When the installation cursor remains locked, unrelated delivery facts must still commit.
    await core.prisma.$transaction(async (held) => {
      await held.$executeRaw`UPDATE installation_journey_clock SET seq = seq + 1 WHERE id = 1`;
      await client.$transaction(async (db) => {
        await db.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
        await projectJourneyEvents(db, { fleetId: fleet.fleetId, events, lastSeq: 1000, computedAt: core.clock.now().toISOString() });
        await projectJourneyEvents(db, { fleetId: fleet.fleetId, events: events.map((event) => ({ ...event, type: 'DeliveryReceived' })), lastSeq: 1030, computedAt: core.clock.now().toISOString() });
        await projectJourneyEvents(db, { fleetId: fleet.fleetId, events: events.map((event) => ({ ...event, type: 'DeliveryAcknowledged' })), lastSeq: 1060, computedAt: core.clock.now().toISOString() });
      });
    });
    // Then qualification costs two statements for all recipients, and no delivery takes the shared clock.
    expect(statements.filter(({ query }) => query.includes('installation_journey_clock'))).toEqual([]);
    expect(statements.filter(({ query }) => /(?:FROM|JOIN) messages m|UPDATE deliveries/.test(query))).toHaveLength(3);
    expect(await core.prisma.delivery.count({ where: { fleetId: fleet.fleetId, journeyQualifying: false } })).toBe(31);
  } finally { await client.$disconnect(); }
});
