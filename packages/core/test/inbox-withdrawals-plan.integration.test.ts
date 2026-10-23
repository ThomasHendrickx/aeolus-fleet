import { WITHDRAWAL_CONTENT_TYPE, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { inboxWithdrawalsStatement } from '../src/adapters/prisma/history.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';

// A question's withdrawals are found by the question id they name, through
// messages_question_id_idx, not by reading argo's inbox: answering or opening
// an old question costs the same as a new one. The plan is asserted, not a
// time, which would flake under load.

const MESSAGES = 50_000;
/** One message in this many withdraws a question, each its own. */
const WITHDRAWAL_EVERY = 50;

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;

beforeAll(async () => {
  core = await createPostgresCore();
  ({ fleetId, operatorShipId: argoId } = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, payload, content_type, idempotency_key, created_at, request_hash, selector_kind, selector_ship_id, sender_ship_id)
    SELECT 'msg_seed' || i, ${fleetId},
           CASE WHEN i % ${WITHDRAWAL_EVERY}::int = 0 THEN '{"questionId":"' || md5(i::text)::uuid || '"}' ELSE 'Slice ' || i || ' done' END,
           CASE WHEN i % ${WITHDRAWAL_EVERY}::int = 0 THEN ${WITHDRAWAL_CONTENT_TYPE} ELSE 'text/plain' END,
           'seed-' || i, now() - interval '30 days' + i * interval '1 minute', 'h', 'ship', ${argoId}, ${argoId}
    FROM generate_series(1, ${MESSAGES}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO deliveries (id, fleet_id, message_id, recipient_ship_id, state, created_at)
    SELECT 'dlv_' || substr(id, 5), fleet_id, id, selector_ship_id, 'pending', created_at
    FROM messages WHERE fleet_id = ${fleetId} AND id LIKE 'msg_seed%'`;
  await core.prisma.$executeRaw`ANALYZE`;
}, 120_000);

afterAll(async () => {
  await core.close();
});

describe("a question's withdrawals on an inbox with a history", () => {
  it('are read through the index of question ids, not every message to argo', async () => {
    const statement = inboxWithdrawalsStatement(fleetId, { shipId: argoId, questionId: '3f1c2a9e-7b4d-4e8a-9c1f-2d6b8e0a5c47', limit: 100 });
    const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${statement}`);

    expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain('messages_question_id_idx');
  });
});
