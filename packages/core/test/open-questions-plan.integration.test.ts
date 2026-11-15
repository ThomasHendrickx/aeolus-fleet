import { ANSWER_CONTENT_TYPE, QUESTION_CONTENT_TYPE, idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fillMessageQuestionIdsStatement } from '../src/adapters/prisma/fill-message-question-ids.js';
import { messageMetadataBatchStatement } from '../src/adapters/prisma/message-metadata-backfill.js';
import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { openQuestionsStatement } from '../src/adapters/prisma/messaging.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { withOperatorLogin } from './support/operator-login.js';
import { operatorCaller } from './support/core-fixtures.js';

// A retiring ship's open questions (#1632) are selected in the query, along
// the index of the questions each ship asked, each checked for its answer and
// its withdrawal by index, one page at a time: never every question and reply
// the ship sent, read and matched in memory. The plan is asserted, not a
// time, which would flake under load.

const MESSAGES = 50_000;
/** One message in this many is a question scout asked argo; every other question argo answered. */
const QUESTION_EVERY = 5;

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;
let scoutId: ShipId;

beforeAll(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId, operatorShipId: argoId } = fleet);
  ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, payload, asked_question_id, content_type, idempotency_key, created_at, request_hash, selector_kind, selector_ship_id, sender_ship_id)
    SELECT 'msg_1' || lpad(i::text, 25, '0'), ${fleetId},
           CASE WHEN i % ${QUESTION_EVERY}::int = 0 THEN '{"id":"' || md5(i::text)::uuid || '"}' ELSE 'Slice ' || i || ' done' END,
           CASE WHEN i % ${QUESTION_EVERY}::int = 0 THEN md5(i::text)::uuid::text END,
           CASE WHEN i % ${QUESTION_EVERY}::int = 0 THEN ${QUESTION_CONTENT_TYPE} ELSE 'text/plain' END,
           'seed-' || i, now() - interval '30 days' + i * interval '1 minute', 'h', 'ship',
           CASE WHEN i % 2 = 0 THEN ${argoId} ELSE ${scoutId} END,
           CASE WHEN i % 2 = 0 THEN ${scoutId} ELSE ${argoId} END
    FROM generate_series(1, ${MESSAGES}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO messages (id, fleet_id, payload, answered_question_id, content_type, idempotency_key, created_at, request_hash, selector_kind, selector_ship_id, sender_ship_id, in_reply_to_message_id)
    SELECT 'msg_0' || substr(id, 6), fleet_id, '{"questionId":"' || asked_question_id || '","option":1}', asked_question_id, ${ANSWER_CONTENT_TYPE},
           'answer-' || id, created_at + interval '1 second', 'h', 'ship', ${scoutId}, ${argoId}, id
    FROM messages WHERE fleet_id = ${fleetId} AND asked_question_id IS NOT NULL AND right(id, 1) IN ('0', '2', '4', '6', '8') AND sender_ship_id = ${scoutId}`;
  await core.prisma.$executeRaw`ANALYZE`;
}, 120_000);

afterAll(async () => {
  await core.close();
});

describe('message metadata backfill at scale', () => {
  it('updates only the messages selected by the batch, using their keys', async () => {
    // Given a bounded batch selected from the existing analysed history.
    const ids = (await core.prisma.message.findMany({ where: { fleetId }, orderBy: { id: 'asc' }, take: 100 })).map((row) => idSchema('message').parse(row.id));
    // When Postgres plans the actual metadata update.
    const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${fillMessageQuestionIdsStatement({ fleetId, ids })}`);
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    // Then the update uses keys rather than scanning history for content types.
    expect(plan).toContain('Index Cond:');
    expect(plan).not.toMatch(/Seq Scan on messages/);
  });

  it('reads each batch from an index range with a message id cursor', async () => {
    // Given the existing 50,000-message history fixture.
    const statement = messageMetadataBatchStatement({ fleetId, after: 'msg_100000000000000000000020000', batchSize: 100 });
    // When Postgres plans the actual batch query.
    const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${statement}`);
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    // Then it bounds its read by the cursor and batch size, without scanning history.
    expect(plan).toContain('Limit');
    expect(plan).toContain('Index');
    expect(plan).toContain('Index Cond:');
    expect(plan).not.toMatch(/Seq Scan on messages/);
  });
});

describe("the open questions of a ship with a long question history", () => {
  it('are selected along the index of the questions it asked, each answer and withdrawal looked up by index, one page at a time', async () => {
    const statement = openQuestionsStatement(fleetId, { shipId: scoutId, limit: 100 });
    const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(Prisma.sql`EXPLAIN ${statement}`);
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');

    expect(plan).toContain('messages_fleet_id_sender_ship_id_id_asked_idx');
    expect(plan).toContain('Limit');
    expect(plan).not.toMatch(/Seq Scan on messages/);
  });
});
