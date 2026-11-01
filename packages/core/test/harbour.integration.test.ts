import type { FleetId, ReportState, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaFleetListing } from '../src/adapters/prisma/registry.js';
import { harbourCountsOf, harbourStateOf } from '../src/domain/registry/harbour.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { wholeShips } from './support/ships.js';

// Harbour's read on Postgres (docs/design/fleet-overview, "The read Harbour
// needs"): the statement works out each ship's state in SQL, so it is held
// here to harbourStateOf, the rule, for every status, report and alert a
// ship can have; and its numbers to harbourCountsOf.

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
const REPORTS = [null, 'working', 'blocked', 'idle'] as const;

async function raiseAlertOn(shipId: ShipId, occurrenceKey: string): Promise<void> {
  unwrap(
    await core.useCases.raiseAlert(argo, {
      shipId,
      signal: 'delivery-unacknowledged',
      occurrenceKey,
      since: '2026-11-01T11:45:00.000Z',
      facts: { deliveryId: occurrenceKey, messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1', state: 'pending', awaitingCrew: true, minutes: 15 },
    }),
  );
}

/** One ship per status, report and alert: crewed with each report, awaiting crew with none, each with and without an open alert. */
async function seedEveryCombination(): Promise<void> {
  const combinations = [
    ...REPORTS.flatMap((report) => [false, true].map((hasAlert) => ({ isCrewed: true, report, hasAlert }))),
    ...[false, true].map((hasAlert) => ({ isCrewed: false, report: null, hasAlert })),
  ];
  for (const [index, { isCrewed, report, hasAlert }] of combinations.entries()) {
    const name = `ship-${String(index).padStart(2, '0')}`;
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'builder' }));
    if (isCrewed) {
      const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
      const crew = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
      if (report !== null) {
        unwrap(await core.useCases.report(crew, { state: report satisfies ReportState, note: `${name} ${report}` }));
      }
    }
    if (hasAlert) {
      await raiseAlertOn(shipId, `dlv_01m66p4k2v9qz8f7x3n5c1d${String(index).padStart(3, '0')}`);
    }
  }
}

beforeAll(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  fleetId = fleet.fleetId;
  argo = operatorCaller(fleet);
  await seedEveryCombination();
  const old = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'old', type: 'builder' }));
  unwrap(await core.useCases.retireShip(argo, { shipId: old.shipId }));
  // The console's own viewer ship, as the installation adds it.
  await core.prisma.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    VALUES ('shp_00000000000000000000000099', ${fleetId}, 'viewer', 'viewer', now(), 'viewer', '{fleet:read}')`;
});

afterAll(async () => {
  await core.close();
});

/** Each active ship as the rule decides its tile, from the fleet snapshot, argo first and then by name. */
async function expectedTiles() {
  const ships = wholeShips((await core.useCases.listFleet(argo)).ships).filter((ship) => ship.kind !== 'viewer' && ship.status !== 'retired');
  return ships.map((ship) => ({
    id: ship.id,
    name: ship.name,
    kind: ship.kind,
    state: harbourStateOf({ status: ship.status === 'awaitingCrew' ? 'awaitingCrew' : 'crewed', reportState: ship.report?.state ?? null, hasOpenAlert: ship.openAlertCount > 0 }),
    note: ship.report?.note ?? null,
  }));
}

describe("Harbour's read on Postgres", () => {
  it('works out each ship the state harbourStateOf gives it, for every status, report and alert, argo first and then by name', async () => {
    const expected = await expectedTiles();

    const harbour = await core.useCases.readHarbour(argo);

    expect(harbour.ships).toEqual(expected);
  });

  it('counts the ships as harbourCountsOf counts them, on the first page', async () => {
    const expected = harbourCountsOf(await expectedTiles());

    const { counts } = await core.useCases.readHarbour(argo, { limit: 3 });

    expect(counts).toEqual(expected);
  });

  it('pages every ship once, a page at a time from the cursor, the numbers on the first page only', async () => {
    const pages: { ids: ShipId[]; hasCounts: boolean }[] = [];
    let cursor: Parameters<PostgresCore['useCases']['readHarbour']>[1] = { limit: 4 };
    for (;;) {
      const page = await core.useCases.readHarbour(argo, cursor);
      pages.push({ ids: page.ships.map((ship) => ship.id), hasCounts: page.counts !== null });
      if (page.nextCursor === null) {
        break;
      }
      cursor = { limit: 4, cursor: page.nextCursor };
    }

    expect([pages.flatMap((page) => page.ids), pages.map((page) => page.hasCounts)]).toEqual([(await expectedTiles()).map((tile) => tile.id), [true, false, false]]);
  });

  it('answers only the ships asked, with their state, and none that is retired', async () => {
    const [first, second] = (await expectedTiles()).slice(1);
    const old = await core.prisma.ship.findFirstOrThrow({ where: { fleetId, name: 'old' } });

    const harbour = await core.useCases.readHarbour(argo, { shipIds: [second?.id, first?.id, old.id].filter((id) => id !== undefined) });

    expect(harbour.ships).toEqual([first, second]);
  });

  it('leaves out the ships outside read reach, and counts only those it reads', async () => {
    const [, first, second] = await expectedTiles();
    const reach = { kind: 'some' as const, shipIds: new Set([first?.id, second?.id].filter((id) => id !== undefined)), types: new Set<string>() };

    const read = await createPrismaFleetListing(core.prisma).harbour(fleetId, { reach, limit: 100 });

    expect([read.ships.map(({ ship }) => ship), read.counts?.ships]).toEqual([[first, second], 2]);
  });
});
