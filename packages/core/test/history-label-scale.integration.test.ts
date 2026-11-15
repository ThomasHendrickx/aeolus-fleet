import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { createPrismaShipHistory, firstDeliveriesStatement } from '../src/adapters/prisma/history.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

const SHIPS = 3_000;
const messageId = idSchema('message').parse('msg_00000000000000000000000001');
let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;

beforeAll(async () => {
  core = await createPostgresCore();
  ({ fleetId, operatorShipId: argoId } = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_' || lpad(i::text, 26, '0'), ${fleetId}, 'ship-' || i, 'agent', now(), 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_value_ids, payload, content_type, idempotency_key, request_hash, created_at)
    VALUES (${messageId}, ${fleetId}, ${argoId}, 'label', ARRAY['lbv_00000000000000000000000001'], 'hello', 'text/plain', 'label', 'h', now())`;
  await core.prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_' || lpad(i::text, 26, '0'), ${fleetId}, ${messageId}, ${argoId}, 'shp_' || lpad(i::text, 26, '0'), 'pending', now()
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`ANALYZE`;
}, 120_000);

afterAll(async () => { await core.close(); });

describe('history of a label send to 3,000 ships', () => {
  it('uses its first delivery for the message and its reach parties', async () => {
    const history = createPrismaShipHistory(core.prisma);
    const firstId = idSchema('delivery').parse('dlv_00000000000000000000000001');
    const firstShip = idSchema('ship').parse('shp_00000000000000000000000001');

    const page = await history.messages(fleetId, { shipId: argoId, limit: 20 });
    const parties = await history.messageParties(fleetId, [messageId]);

    expect(page?.items[0]?.delivery.id).toBe(firstId);
    expect(parties.get(messageId)?.recipient).toEqual({ kind: 'ship', shipId: firstShip });
  });

  it('reads one delivery per message through the delivery index', async () => {
    const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${firstDeliveriesStatement(fleetId, [messageId])}`);
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    expect(plan).toContain('Limit');
    expect(plan).toContain('deliveries_fleet_id_message_id_id_idx');
  });
});
