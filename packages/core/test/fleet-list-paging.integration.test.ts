import { idSchema, PAGE_SIZE_MAX, SHIP_SORT_COLUMNS, type FleetId, type LabelValueId, type ShipId, type ShipPosition } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../src/adapters/prisma/generated/client.js';
import { fleetListingStatement, shipTypesStatement } from '../src/adapters/prisma/registry.js';
import type { ShipPage } from '../src/domain/registry/ports.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';

// The fleet snapshot at the target size (decision 4 of the performance
// design): 3,000 ships page by cursor in any order the overview sorts by,
// each ship once, and only a page's ships read what costs a query of its
// own. The plan is asserted, not a time, which would flake under load;
// staging measures the time (decision 7).

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
async function everyPage(input: Omit<NonNullable<Parameters<PostgresCore['useCases']['listFleet']>[1]>, 'cursor'> & { limit: number }): Promise<ShipId[][]> {
  const pages: ShipId[][] = [];
  let cursor: ShipPosition | undefined;
  do {
    const page = await core.useCases.listFleet(argo, { ...input, cursor });
    pages.push(page.ships.map((ship) => ship.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return pages;
}

/** The plan of reading one page, as Postgres ran it. */
async function planOfPage(page: ShipPage): Promise<unknown> {
  const [row] = await core.prisma.$queryRaw<{ 'QUERY PLAN': unknown }[]>(Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${fleetListingStatement(fleetId, page)}`);
  return row?.['QUERY PLAN'];
}

/** How many times the plan read the index named, over every node that reads it. */
function loopsOfIndex(plan: unknown, index: string): number {
  if (Array.isArray(plan)) {
    return plan.reduce((sum: number, each) => sum + loopsOfIndex(each, index), 0);
  }
  if (typeof plan !== 'object' || plan === null) {
    return 0;
  }
  const node = new Map(Object.entries(plan));
  const own = node.get('Index Name') === index ? Number(node.get('Actual Loops')) : 0;
  return own + [...node.values()].reduce((sum: number, each) => sum + loopsOfIndex(each, index), 0);
}

/** How many ships the plan read through the index named, before any filter dropped one, over every node that reads it. */
function rowsOfIndex(plan: unknown, index: string): number {
  if (Array.isArray(plan)) {
    return plan.reduce((sum: number, each) => sum + rowsOfIndex(each, index), 0);
  }
  if (typeof plan !== 'object' || plan === null) {
    return 0;
  }
  const node = new Map(Object.entries(plan));
  const own = node.get('Index Name') === index ? (Number(node.get('Actual Rows')) + Number(node.get('Rows Removed by Filter') ?? 0)) * Number(node.get('Actual Loops')) : 0;
  return own + [...node.values()].reduce((sum: number, each) => sum + rowsOfIndex(each, index), 0);
}

/** Seeded ship number i, as the seed names it. */
function seeded(i: number): { id: ShipId; name: string } {
  return { id: idSchema('ship').parse(`shp_0${String(i).padStart(25, '0')}`), name: `ship-${String(i)}` };
}

/** What the listing selects when the caller asks no status: the active ships. */
const ACTIVE = { status: ['awaitingCrew', 'crewed'] } as const;

describe('a page of 20 at 3,000 ships, read through its keyset index (decision 4 of the performance design)', () => {
  it('reads only the page of the default order, argo first and then by name, however far on it starts', async () => {
    const { id, name } = seeded(2_800);
    const plan = await planOfPage({ after: { isEmpty: true, value: '', name, id }, limit: 21, filter: ACTIVE, reach: { kind: 'every' } });

    expect(rowsOfIndex(plan, 'ships_listing_idx')).toBeOneOf([21, 22]);
  });

  it.each(['ascending', 'descending'] as const)('reads only the page sorted by ship %s, however far on it starts', async (direction) => {
    const { id, name } = seeded(2_000);
    const plan = await planOfPage({ after: { isEmpty: false, value: name, name, id }, limit: 21, filter: ACTIVE, sort: { column: 'ship', direction }, reach: { kind: 'every' } });

    // Beyond the page: the cursor's own ship, and one more that ends the last name's ties.
    expect(rowsOfIndex(plan, 'ships_name_listing_idx')).toBeOneOf([21, 22, 23]);
  });
});

describe("the fleet's ship types at 3,000 ships", () => {
  it('answers each type once, read from the type index alone', async () => {
    const [row] = await core.prisma.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
      Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${shipTypesStatement(fleetId, { status: ['awaitingCrew', 'crewed'], reach: { kind: 'every' } })}`,
    );

    expect([await core.useCases.listShipTypes(argo), rowsOfIndex(row?.['QUERY PLAN'], 'ships_type_listing_idx') > 0]).toEqual([['agent', 'operator'], true]);
  });
});

describe('the fleet snapshot at 3,000 ships (decision 4 of the performance design)', () => {
  it('pages every ship once, argo first and then by name, in pages of the size asked', async () => {
    const pages = await everyPage({ limit: PAGE_SIZE_MAX });
    const ships = await core.prisma.ship.findMany({ where: { fleetId }, select: { id: true, name: true, kind: true } });
    const expected = ships
      .toSorted((first, second) => Number(first.kind !== 'operator') - Number(second.kind !== 'operator') || (first.name < second.name ? -1 : first.name > second.name ? 1 : 0))
      .map(({ id }) => id);

    expect([pages.map((page) => page.length), pages.flat()]).toEqual([[500, 500, 500, 500, 500, 500, ships.length - 3_000], expected]);
  });

  it.each(SHIP_SORT_COLUMNS.flatMap((column) => [{ column, direction: 'ascending' as const }, { column, direction: 'descending' as const }]))(
    'pages every ship once sorted by $column $direction, however many tie',
    async (sort) => {
      const shipIds = await everyPage({ sort, limit: 450 });

      expect(new Set(shipIds.flat()).size).toEqual(await core.prisma.ship.count({ where: { fleetId } }));
      expect(shipIds.flat()).toHaveLength(await core.prisma.ship.count({ where: { fleetId } }));
    },
  );

  it('pages only the ships that carry the label value, each page full', async () => {
    const pages = await everyPage({ limit: 100, valueIds: [labelled] });

    expect(pages.map((page) => page.length)).toEqual([100, 100, 100, 100, 28]);
  });

  it('reads who crewed a ship, its last ping and model for the ships of the page only, not every ship it orders', async () => {
    const plan = await planOfPage({ limit: 21, filter: {}, sort: { column: 'seen', direction: 'ascending' }, reach: { kind: 'every' } });

    expect([loopsOfIndex(plan, 'events_starting_prompt_issued_idx') <= 21, loopsOfIndex(plan, 'messages_pings_idx') <= 21]).toEqual([true, true]);
  });
});
