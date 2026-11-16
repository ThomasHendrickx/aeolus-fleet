import { afterAll, beforeAll, expect, it } from 'vitest';

import { createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { ok } from '../src/domain/shared/result.js';
import { createPrismaEventLog } from '../src/adapters/prisma/event-log.js';
import { createPrismaInstallationFleets } from '../src/adapters/prisma/installation.js';
import { journeyPageStatement, journeyChangesStatement, createPrismaInstallationJourneyReads } from '../src/adapters/prisma/fleet-journeys.js';
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
  const sent = unwrap(await core.useCases.sendMessage(operatorCaller(fleet), { selector: { kind: 'ship', shipId: fleet.operatorShipId }, payload: 'not selected by journey reads', idempotencyKey: 'plan-source' }));
  const delivery = await core.prisma.delivery.findFirstOrThrow({ where: { fleetId: fleet.fleetId, messageId: sent.messageId } });
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => statements.push({ query, params }));
  try {
    // When real projection, source, get, page and change adapters read this fleet.
    const event = { id: ids('event'), fleetId: fleet.fleetId, type: 'ShipClaimed' as const, occurredAt: core.clock.now(), actor: { kind: 'system' as const }, shipId: fleet.operatorShipId, details: {} };
    await journeySourceFact(client, event);
    await journeySourceFact(client, { ...event, type: 'MessageAccepted', messageId: sent.messageId, deliveryId: idSchema('delivery').parse(delivery.id) });
    await createPrismaInstallationJourneyReads(client).page();
    await createPrismaInstallationJourneyReads(client).changes(0n);
    await createPrismaInstallationFleets(client).find(fleet.fleetId, messageWindow(core.clock.now()));
    await createPrismaFleetRepository(client).find(fleet.fleetId);
    const log = createPrismaEventLog(client);
    await log.append(event);
    await log.flush();
    await createPrismaUnitOfWork(client).run(async (tx) => ok(await tx.fleets.find(fleet.fleetId)));
    // Then history lookups stay indexed and the fleet resources read compact projections only.
    for (const statement of statements.filter((statement) => /^\s*(SELECT|UPDATE)/.test(statement.query) && !statement.query.includes('pg_notify'))) await assertIndexedPlan(core.prisma, statement);
    const page = await assertIndexedPlan(core.prisma, journeyPageStatement({ createdAt: new Date('2020-01-01'), fleetId: fleet.fleetId }));
    const changes = await assertIndexedPlan(core.prisma, journeyChangesStatement(0n));
    expect(page).not.toContain('messages');
    expect(changes).not.toContain('messages');
    expect(statements.some((statement) => statement.query.includes('fleet_journeys'))).toBe(true);
  } finally { await client.$disconnect(); }
});
