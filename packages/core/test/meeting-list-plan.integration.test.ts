/** A ship in 10,000 meetings reads bounded index ranges, not its whole history. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { meetingListStatement } from '../src/adapters/prisma/meetings.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { operatorCaller } from './support/core-fixtures.js';
import { meetingId, OPENED } from './support/meeting-list-scenarios.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import type { FleetId, ShipId } from '@aeolus-fleet/common';

const HISTORY = 10_000;
const OPEN = 20;
let core: PostgresCore;
let fleetId: FleetId;
let shipId: ShipId;
beforeAll(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'meeting list plan' })));
  ({ fleetId } = fleet);
  ({ shipId } = unwrap(await core.useCases.commissionShip(operatorCaller(fleet), { name: 'reader', type: 'agent', idempotencyKey: newKey() })));
  await core.prisma.$executeRaw`
    INSERT INTO meetings (fleet_id, id, title, owner_ship_id, moderator_ship_id, opened_by_ship_id, idempotency_key, request_hash, opened_at, ended_at)
    SELECT ${fleetId}, 'mtg_' || lpad(i::text, 26, '0'), 'Planning', ${shipId}, ${shipId}, ${shipId}, 'meeting-' || i, 'hash', ${OPENED},
      CASE WHEN i <= ${HISTORY - OPEN}::int THEN ${OPENED}::timestamptz ELSE NULL END
    FROM generate_series(1, ${HISTORY}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO meeting_participants (fleet_id, meeting_id, ship_id, joined_at, place, meeting_opened_at, is_meeting_ended)
    SELECT ${fleetId}, id, ${shipId}, opened_at, 0, opened_at, ended_at IS NOT NULL FROM meetings WHERE fleet_id = ${fleetId}`;
  await core.prisma.$executeRaw`ANALYZE`;
});
afterAll(async () => { await core?.close(); });

const nodeSchema = z.object({
  'Node Type': z.string(), 'Relation Name': z.string().optional(), 'Index Name': z.string().optional(),
  'Plan Rows': z.number(), Plans: z.array(z.unknown()).optional(),
});

function nodes(value: unknown): z.infer<typeof nodeSchema>[] {
  const node = nodeSchema.parse(value);
  return [node, ...(node.Plans ?? []).flatMap(nodes)];
}

function hasUnboundedParticipantScan(value: unknown): boolean {
  const node = nodeSchema.parse(value);
  if (node['Node Type'] === 'Limit') return false;
  return node['Relation Name'] === 'meeting_participants' || (node.Plans ?? []).some(hasUnboundedParticipantScan);
}

describe('the meeting list plan for 10,000 meetings, 20 open', () => {
  it.each([20, 100])('uses both bounded halves on the new index for a page of %i, with no sequential scan or sort of the ship history', async (limit) => {
    // Given the ship has a long ended history and 20 open meetings.
    // When it asks for the first page or continues within the open half.
    for (const cursor of [undefined, `o.${String(OPENED.getTime())}.${meetingId(9995)}`]) {
      const plan = await assertIndexedPlan(core.prisma, meetingListStatement(fleetId, { shipId, limit, cursor }));
      const plans = z.array(z.object({ 'QUERY PLAN': z.array(z.object({ Plan: z.unknown() })) })).parse(JSON.parse(plan));
      const all = plans.flatMap((row) => row['QUERY PLAN'].flatMap((entry) => nodes(entry.Plan)));

      // Then both sections use the ordered index; any sort is after the bounded halves.
      expect(all.filter((node) => node['Index Name'] === 'meeting_participants_ship_list_idx')).toHaveLength(2);
      expect(all.filter((node) => node['Node Type'].includes('Seq Scan') && ['meeting_participants', 'meetings'].includes(node['Relation Name'] ?? ''))).toEqual([]);
      for (const node of all.filter((node) => node['Node Type'] === 'Sort')) {
        expect((node.Plans ?? []).some(hasUnboundedParticipantScan), plan).toBe(false);
      }
    }
  });

  it('continues in the ended index range without scanning open meetings', async () => {
    // Given the cursor has entered the ended section.
    // When the ship continues after an ended row.
    const plan = await assertIndexedPlan(core.prisma, meetingListStatement(fleetId, { shipId, limit: 20, cursor: `e.${String(OPENED.getTime())}.${meetingId(5000)}` }));
    // Then the ordered index remains in use with no sequential scan of meetings or participants.
    expect(plan).toContain('meeting_participants_ship_list_idx');
    expect(plan).not.toMatch(/"Node Type": "Seq Scan",\s*[^}]*"Relation Name": "(?:meeting_participants|meetings)"/);
  });
});
