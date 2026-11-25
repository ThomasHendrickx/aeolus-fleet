/** Public evidence projects facts from the indexed ship/message reads, never lease or message history. */
import { createIdGenerator } from '@aeolus-fleet/common';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createReportCrewStatus } from '../src/domain/registry/report-crew-status.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createPrismaFleetListing } from '../src/adapters/prisma/registry.js';
import { createPrismaShipHistory } from '../src/adapters/prisma/history.js';
import { toMessage } from '../src/adapters/prisma/rows.js';
import { unwrap } from '../src/testing/result.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { aCrewSettings } from './support/crew-fixtures.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';

let core: PostgresCore;
beforeAll(async () => { core = await createPostgresCore(); });
afterAll(async () => { await core.close(); });

it('reads one current lease and immutable sending evidence by indexed ship and message with a long history', async () => {
  // Given 3,000 ships, 60,000 ended leases and unrelated message history.
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'evidence scale' }));
  const argo = operatorCaller(fleet);
  const ship = unwrap(await core.useCases.commissionShip(argo, { name: 'sender', type: 'reviewer', idempotencyKey: 'sender' }));
  const guard = { sets: [{ name: 'no-push', repository: 'company/rules', commit: '8d41e07', floor: true }], refusals: 0, recent: [] };
  unwrap(await core.useCases.requestCrew(argo, { shipId: ship.shipId, settings: aCrewSettings({ ruleSet: 'no-push' }) }));
  unwrap(await core.useCases.assignCrew(argo, { shipId: ship.shipId, trierarchShipId: argo.shipId, settingsVersion: 1 }));
  const claimed = unwrap(await core.useCases.claimShip({ shipId: ship.shipId, secret: secretOf(ship.secret), location: { kind: 'SERVER' } }));
  const crew = unwrap(await core.useCases.authenticate.byCrewToken(claimed.crewToken));
  const { messageId } = unwrap(await core.useCases.sendMessage(crew, { selector: { kind: 'ship', shipId: argo.shipId }, payload: 'Confirmed', model: 'gpt-6.1-sol', idempotencyKey: 'confirmed' }));
  await core.prisma.$executeRaw`INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleet.fleetId}, 'ship-' || i, 'agent', ${core.clock.now()}, 'agent', '{}' FROM generate_series(1, 3000) i`;
  await core.prisma.$executeRaw`INSERT INTO leases (id, fleet_id, ship_id, location, crew_token_hash, started_at, ended_at)
    SELECT 'lse_' || lpad((i * 100 + n)::text, 26, '0'), ${fleet.fleetId}, 'shp_' || lpad(i::text, 26, '0'), 'SERVER'::location_kind, 'hash-' || i || '-' || n,
      ${core.clock.now()}::timestamptz - interval '1 day', ${core.clock.now()}
    FROM generate_series(1, 3000) i, generate_series(1, 20) n`;
  await core.prisma.$executeRaw`INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_ship_id, payload, content_type, idempotency_key, request_hash, created_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), ${fleet.fleetId}, ${argo.shipId}, 'ship', ${argo.shipId}, 'history', 'text/plain', 'seed-' || i, 'h', ${core.clock.now()} FROM generate_series(1, 30000) i`;
  await core.prisma.$executeRaw`INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), ${fleet.fleetId}, 'msg_' || lpad(i::text, 26, '0'), ${argo.shipId}, ${argo.shipId}, 'pending', ${core.clock.now()} FROM generate_series(1, 30000) i`;
  await core.prisma.$executeRaw`INSERT INTO events (id, fleet_id, type, occurred_at, actor_kind, actor_ship_id, details, ship_id, message_id, delivery_id, seq)
    SELECT 'evt_' || lpad(i::text, 26, '0'), ${fleet.fleetId}, 'MessageAccepted', ${core.clock.now()}, 'ship', ${argo.shipId}, '{}', ${argo.shipId},
      'msg_' || lpad(i::text, 26, '0'), 'dlv_' || lpad(i::text, 26, '0'), 1000000 + i FROM generate_series(1, 30000) i`;
  await core.prisma.$executeRaw`ANALYZE`;
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => statements.push({ query, params }));
  try {
    // When the guard is reported and the actual adapters fetch the referenced ship and message.
    const report = createReportCrewStatus({ uow: createPrismaUnitOfWork(client), clock: core.clock, ids: createIdGenerator() });
    unwrap(await report(argo, { shipId: ship.shipId, status: 'running', guard }));
    const facts = await createPrismaFleetListing(client).ship(fleet.fleetId, ship.shipId);
    const message = await createPrismaShipHistory(client).message(fleet.fleetId, messageId);
    const stored = toMessage(await client.message.findUniqueOrThrow({ where: { id: messageId } }));

    // Then evidence survives projection and every history lookup uses its index.
    expect(facts?.crewRequest?.guard).toEqual(guard);
    expect(facts?.openLease).toMatchObject({ id: crew.leaseId });
    expect(message).toMatchObject({ senderLeaseId: crew.leaseId });
    expect(stored.senderLeaseId).toBe(crew.leaseId);
    const reads = statements.filter(({ query }) => /^\s*SELECT/.test(query));
    expect(reads.length).toBeGreaterThan(0);
    for (const statement of reads) {
      const plan = await assertIndexedPlan(core.prisma, statement);
      if (statement.query.includes('LEFT JOIN leases')) {
        expect(plan).toContain('leases_ship_id_open_key');
        expect(plan).not.toMatch(/Seq Scan[^}]*leases/);
      }
    }
  } finally { await client.$disconnect(); }
});
