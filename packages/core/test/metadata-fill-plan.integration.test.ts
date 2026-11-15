import { idSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { exchangeListStatement } from '../src/adapters/prisma/exchange-rollups.js';
import { fillMessageQuestionIdsStatement } from '../src/adapters/prisma/fill-message-question-ids.js';
import {
  createPrismaMetadataFillIndexes,
  fillUnseenPlainMessagesStatement,
  metadataFillCursorStatement,
  metadataFillExchangesStatement,
  metadataFillMessagesStatement,
} from '../src/adapters/prisma/message-metadata-fill.js';
import type { ExchangeKey } from '../src/domain/messaging/ports.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { seedScaleFleet } from './support/scale-fleet.js';

// Each statement of a metadata fill batch (docs/architecture.md, Backfills),
// and the read of an exchange it has not filled yet, planned on the shared
// scale fixture: every one reads an index range or looks rows up by key,
// never a history scan. The plan is asserted, not a time.

const BATCH = 100;

let core: PostgresCore;
let fleetId: FleetId;
let messageIds: MessageId[];
let exchanges: ExchangeKey[];

const planNode = z.object({ 'Node Type': z.string(), 'Relation Name': z.string().optional(), Plans: z.array(z.unknown()).optional() });

/** The tables a plan reads with a sequential scan, at any depth. */
function scannedTables(value: unknown): string[] {
  const node = planNode.parse(value);
  const relation = node['Relation Name'];
  const scans = relation !== undefined && node['Node Type'].includes('Seq Scan') ? [relation] : [];
  return [...scans, ...(node.Plans ?? []).flatMap(scannedTables)];
}

function exchangeScans(plan: string): string[] {
  const rows = z.array(z.object({ 'QUERY PLAN': z.array(z.object({ Plan: z.unknown() })) })).parse(JSON.parse(plan));
  return rows.flatMap((row) => row['QUERY PLAN'].flatMap((entry) => scannedTables(entry.Plan))).filter((table) => table === 'exchanges');
}

beforeAll(async () => {
  core = await createPostgresCore();
  const fleet = await seedScaleFleet(core);
  fleetId = fleet.fleetId;
  // Every agent's exchange with argo, from before the fill: no count yet.
  await core.prisma.$executeRaw`
    INSERT INTO exchanges (fleet_id, ship_id, other_ship_id, newest_message_id, unacknowledged, unseen_plain_messages)
    SELECT ${fleetId}, s.id, ${fleet.operatorShipId}, (SELECT max(m.id) FROM messages m WHERE m.fleet_id = s.fleet_id AND m.selector_ship_id = s.id), 0, NULL
    FROM ships s WHERE s.fleet_id = ${fleetId} AND s.id <> ${fleet.operatorShipId}`;
  await core.prisma.$executeRaw`UPDATE deliveries SET is_in_exchange = true WHERE fleet_id = ${fleetId}`;
  await core.prisma.$executeRaw`INSERT INTO message_metadata_backfills (fleet_id) VALUES (${fleetId})`;
  // As core serves once the fill built its indexes after start.
  await createPrismaMetadataFillIndexes(core.prisma).build();
  await core.prisma.$executeRaw`ANALYZE`;
  messageIds = (await core.prisma.message.findMany({ where: { fleetId }, orderBy: { id: 'asc' }, skip: 60_000, take: BATCH, select: { id: true } })).map((row) => idSchema('message').parse(row.id));
  exchanges = (await core.prisma.exchange.findMany({ where: { fleetId }, orderBy: [{ shipId: 'asc' }, { otherShipId: 'asc' }], skip: 1_500, take: BATCH }))
    .map((row): ExchangeKey => ({ shipId: idSchema('ship').parse(row.shipId), otherShipId: idSchema('ship').parse(row.otherShipId) }));
}, 300_000);

afterAll(async () => {
  await core.close();
});

describe('a metadata fill batch on a fleet with a long history', () => {
  it('locks its cursor by the fleet key', async () => {
    const plan = await assertIndexedPlan(core.prisma, metadataFillCursorStatement(fleetId));

    expect(plan).toContain('message_metadata_backfills_pkey');
  });

  it.each([
    ['the first batch', null],
    ['a batch in the middle', 'msg_00000000000000000000060000'],
  ] satisfies [string, MessageId | null][])('reads %s of messages as a range of the fleet and message id key', async (_, after) => {
    const plan = await assertIndexedPlan(core.prisma, metadataFillMessagesStatement({ fleetId, after, limit: BATCH }));

    expect(plan).toMatch(/messages_(pkey|fleet_id_id_key)/);
    expect(plan).toContain('"Node Type": "Limit"');
  });

  it("fills the batch's question ids by each message's key", async () => {
    const plan = await assertIndexedPlan(core.prisma, fillMessageQuestionIdsStatement({ fleetId, ids: messageIds }));

    expect(plan).toMatch(/messages_(pkey|fleet_id_id_key)/);
  });

  it.each([
    ['the first batch', null],
    ['a batch in the middle', 'middle'],
  ] satisfies [string, 'middle' | null][])('locks %s of exchanges as a range of the exchanges key', async (_, from) => {
    const first = exchanges[0];
    const after: ExchangeKey | null = from === null || first === undefined ? null : first;

    const plan = await assertIndexedPlan(core.prisma, metadataFillExchangesStatement({ fleetId, after, limit: BATCH }));

    expect(plan).toContain('exchanges_pkey');
    expect(plan).toContain('"Node Type": "LockRows"');
    expect(exchangeScans(plan)).toEqual([]);
  });

  it("recounts the batch's exchanges as a range of their key, each from its open deliveries, each message by key", async () => {
    const [first, last] = [exchanges[0], exchanges.at(-1)];
    expect(last).toBeDefined();

    const plan = await assertIndexedPlan(core.prisma, fillUnseenPlainMessagesStatement({ fleetId, after: first ?? null, last: last ?? { shipId: 'shp_none', otherShipId: 'shp_none' } }));

    expect(plan).toContain('exchanges_pkey');
    expect(plan).toContain('deliveries_open_exchange_idx');
    expect(plan).toMatch(/messages_(pkey|fleet_id_id_key)/);
    expect(exchangeScans(plan)).toEqual([]);
  });
});

describe('the list of exchanges while the fill has not reached them', () => {
  it('recounts each listed exchange from its open deliveries', async () => {
    const shipId: ShipId | undefined = exchanges[0]?.shipId;
    expect(shipId).toBeDefined();

    const plan = await assertIndexedPlan(core.prisma, exchangeListStatement({ fleetId, shipId: shipId ?? 'shp_none', limit: 50 }));

    expect(plan).toContain('deliveries_open_exchange_idx');
    expect(exchangeScans(plan)).toEqual([]);
  });
});
