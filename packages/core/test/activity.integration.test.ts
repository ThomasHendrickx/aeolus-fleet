import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ShipCaller } from '../src/domain/shared/caller.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { newKey } from '../src/testing/keys.js';
import { aCrewSettings } from './support/crew-fixtures.js';
import { wholeShips } from './support/ships.js';
import { withOperatorLogin } from './support/operator-login.js';

// Lease activity on a real Postgres (docs/design/monitoring, 4.3): written by
// the assigned trierarch, stored with the open lease, read with the ship, and
// none for the ship's next crew.

let core: PostgresCore;
let argo: ShipCaller;
let trierarch: ShipCaller;
let scoutId: ShipCaller['shipId'];
let strayId: ShipCaller['shipId'];

async function commissionedAndCrewed(name: string): Promise<ShipCaller['shipId']> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'reviewer' }));
  unwrap(await core.useCases.requestCrew(argo, { shipId, settings: aCrewSettings({ harness: 'claude-code' }) }));
  unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return shipId;
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  const { shipId: pluginId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'plugin', scopes: ['crew:assign'] }));
  const { shipId: trierarchId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] }));
  const plugin: ShipCaller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:assign'] };
  trierarch = { fleetId: argo.fleetId, shipId: trierarchId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'crew:run'] };
  scoutId = await commissionedAndCrewed('scout');
  strayId = await commissionedAndCrewed('stray');
  unwrap(await core.useCases.assignCrew(plugin, { shipId: scoutId, trierarchShipId: trierarchId }));
  core.clock.advance(60_000);
});

afterEach(async () => {
  await core.close();
});

async function activityOf(shipId: ShipCaller['shipId']) {
  return wholeShips((await core.useCases.listFleet(argo)).ships).find((ship) => ship.id === shipId)?.activity;
}

describe('lease activity on Postgres', () => {
  it('refuses an unassigned ship and takes the rest, stored with the open lease and read with the ship', async () => {
    const written = unwrap(
      await core.useCases.reportActivity(trierarch, {
        intervalSeconds: 30,
        activities: [
          { shipId: strayId, at: '2026-10-31T08:59:50.000Z', kind: 'tool', tool: 'Bash' },
          { shipId: scoutId, at: '2026-10-31T08:59:50.000Z', kind: 'tool', tool: 'Bash' },
        ],
      }),
    );

    expect(written.refused).toEqual([{ shipId: strayId, error: expect.objectContaining({ kind: 'CREW_REQUEST_NOT_ASSIGNED_TO_CALLER' }) }]);
    const expected = { at: new Date('2026-10-31T08:59:50.000Z'), kind: 'tool', tool: 'Bash', reportedAt: core.clock.now(), intervalSeconds: 30 };
    await expect(activityOf(scoutId)).resolves.toEqual(expected);
    await expect(activityOf(strayId)).resolves.toBeNull();
    await expect(core.useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({ isOk: true, value: { activity: expected } });
    await expect(core.prisma.event.count({ where: { shipId: scoutId, occurredAt: { gte: core.clock.now() } } })).resolves.toBe(0);
  });

  it("goes with the lease: the ship's next crew starts with none", async () => {
    unwrap(await core.useCases.reportActivity(trierarch, { intervalSeconds: 30, activities: [{ shipId: scoutId, at: '2026-10-31T08:59:50.000Z', kind: 'text' }] }));

    unwrap(await core.useCases.releaseShip(trierarch, { shipId: scoutId }));

    await expect(activityOf(scoutId)).resolves.toBeNull();
    await expect(core.useCases.reportActivity(trierarch, { intervalSeconds: 30, activities: [{ shipId: scoutId, at: '2026-10-31T09:00:10.000Z', kind: 'text' }] })).resolves.toMatchObject({
      isOk: true,
      value: { refused: [{ shipId: scoutId, error: { kind: 'SHIP_NOT_CREWED' } }] },
    });
  });
});
