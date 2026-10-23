import { PAGE_SIZE_MAX, type FleetId, type LabelValueId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { fleetListingStatement } from '../src/adapters/prisma/registry.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';

// The fleet snapshot at the target size (decision 4 of the performance
// design): 3,000 ships page by cursor on the ship id, each page read on
// through an index of the ships in id order from its cursor, so a page costs
// the same at any fleet size. The plan is asserted, not a time, which would
// flake under load; staging measures the time (decision 7).

const SHIPS = 3_000;
/** One seeded ship in this many carries the label value. */
const LABELLED_EVERY = 7;

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
let labelled: LabelValueId;

beforeAll(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  const label = unwrap(await core.useCases.defineLabel(argo, { key: 'os', values: ['macos'] }));
  labelled = label.values[0]?.id ?? labelled;
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_0' || lpad(i::text, 25, '0'), ${fleetId}, 'ship-' || i, 'agent', now(), 'agent', '{}'
    FROM generate_series(1, ${SHIPS}::int) i`;
  await core.prisma.$executeRaw`
    INSERT INTO ship_labels (fleet_id, ship_id, label_id, value_id)
    SELECT ${fleetId}, 'shp_0' || lpad(i::text, 25, '0'), ${label.labelId}, ${labelled}
    FROM generate_series(1, ${SHIPS}::int) i WHERE i % ${LABELLED_EVERY}::int = 0`;
  await core.prisma.$executeRaw`ANALYZE`;
}, 120_000);

afterAll(async () => {
  await core.close();
});

/** Every page of the fleet snapshot, read on from each page's next cursor. */
async function everyPage(input: { limit: number; valueIds?: LabelValueId[] }): Promise<ShipId[][]> {
  const pages: ShipId[][] = [];
  let cursor: ShipId | undefined;
  do {
    const page = await core.useCases.listFleet(argo, { ...input, cursor });
    pages.push(page.ships.map((ship) => ship.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return pages;
}

describe('the fleet snapshot at 3,000 ships (decision 4 of the performance design)', () => {
  it('pages every ship once, oldest first, in pages of the size asked', async () => {
    const pages = await everyPage({ limit: PAGE_SIZE_MAX });
    const shipIds = await core.prisma.ship.findMany({ where: { fleetId }, select: { id: true }, orderBy: { id: 'asc' } });

    expect([pages.map((page) => page.length), pages.flat()]).toEqual([[500, 500, 500, 500, 500, 500, shipIds.length - 3_000], shipIds.map(({ id }) => id)]);
  });

  it('pages only the ships that carry the label value, each page full', async () => {
    const pages = await everyPage({ limit: 100, valueIds: [labelled] });

    expect(pages.map((page) => page.length)).toEqual([100, 100, 100, 100, 28]);
  });

  it('reads a page on from its cursor through an index of the ships in id order, and stops at the page', async () => {
    const rows = await core.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(
      Prisma.sql`EXPLAIN ${fleetListingStatement(fleetId, { after: 'shp_00000000000000000000001500', limit: PAGE_SIZE_MAX + 1 })}`,
    );
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');

    expect([plan.trimStart().startsWith('Limit'), /Index Scan using (ships_pkey|ships_fleet_id_id_key) on ships s\b/.test(plan), plan.includes('Sort Key: s.id')]).toEqual([true, true, false]);
  });
});
