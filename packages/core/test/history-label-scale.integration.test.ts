import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaShipHistory, firstDeliveriesStatement } from '../src/adapters/prisma/history.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { seedScaleFleet } from './support/scale-fleet.js';

const SHIPS = 3_000;
const messageId = idSchema('message').parse('msg_09999999999999999999999999');
let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;

beforeAll(async () => {
  core = await createPostgresCore();
  ({ fleetId, operatorShipId: argoId } = await seedScaleFleet(core));
  // One extra recipient keeps this label send's original 3,000 recipients besides argo.
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    VALUES ('shp_' || lpad(${SHIPS}::text, 26, '0'), ${fleetId}, 'label-recipient', 'agent', now(), 'agent', '{}')`;
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, sender_ship_id, selector_kind, selector_value_ids, payload, content_type, idempotency_key, request_hash, created_at)
    VALUES (${messageId}, ${fleetId}, ${argoId}, 'label', ARRAY['lbv_00000000000000000000000001'], 'hello', 'text/plain', 'label', 'h', now())`;
  await core.prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, sender_ship_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_1' || lpad(i::text, 25, '0'), ${fleetId}, ${messageId}, ${argoId}, 'shp_' || lpad(i::text, 26, '0'), 'pending', now()
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`ANALYZE`;
}, 120_000);

afterAll(async () => { await core.close(); });

describe('history of a label send to 3,000 ships', () => {
  it('uses its first delivery for the message and its reach parties', async () => {
    const history = createPrismaShipHistory(core.prisma);
    const firstId = idSchema('delivery').parse('dlv_10000000000000000000000001');
    const firstShip = idSchema('ship').parse('shp_00000000000000000000000001');

    const page = await history.messages(fleetId, { shipId: argoId, limit: 20, cursor: idSchema('message').parse('msg_10000000000000000000000000') });
    const parties = await history.messageParties(fleetId, [messageId]);

    expect(page?.items.find((item) => item.id === messageId)?.delivery.id).toBe(firstId);
    expect(parties.get(messageId)?.recipient).toEqual({ kind: 'ship', shipId: firstShip });
  });

  it('reads one delivery per message through the delivery index', async () => {
    const plan = await assertIndexedPlan(core.prisma, firstDeliveriesStatement(fleetId, [messageId]));
    expect(plan).toContain('Limit');
    expect(plan).toContain('deliveries_fleet_id_message_id_id_idx');
  });
});
