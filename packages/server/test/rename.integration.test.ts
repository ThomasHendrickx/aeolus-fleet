import { createIdGenerator, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createCommissionShip } from '../src/core/registry/commission-ship.js';
import { createRenameShip } from '../src/core/registry/rename-ship.js';
import type { Caller } from '../src/core/shared/caller.js';
import { OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// Renaming on a real Postgres: the new name and ShipRenamed in one
// transaction, and the name lock that keeps a rename and a commission, or two
// renames, from both taking one name.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: Caller;
let scoutId: ShipId;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  ({ shipId: scoutId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
});

afterEach(async () => {
  await core.close();
});

/** The ship ports, held at the name lookup until every racing transaction gets there. */
function racingShips(transactions: number) {
  return racingUnitOfWork({ prisma: core.prisma, transactions }, (tx, allArrived) => ({
    ...tx,
    ships: {
      ...tx.ships,
      findActiveByName: async (fleet, name) => {
        await allArrived();
        return tx.ships.findActiveByName(fleet, name);
      },
    },
  }));
}

describe('renaming a ship on Postgres', () => {
  it('stores the new name and ShipRenamed, caused by argo', async () => {
    unwrap(await core.useCases.renameShip(argo, { shipId: scoutId, name: 'lookout' }));

    await expect(core.prisma.ship.findUniqueOrThrow({ where: { id: scoutId } })).resolves.toMatchObject({ name: 'lookout' });
    await expect(core.prisma.event.findMany({ where: { type: 'ShipRenamed' } })).resolves.toEqual([
      expect.objectContaining({ shipId: scoutId, actorShipId: argo.shipId, details: { from: 'scout', to: 'lookout' } }),
    ]);
  });

  it('lets one of two concurrent renames to one name take it; the other is refused', async () => {
    const { shipId: otherId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'other', type: 'reviewer' }));
    const renameShip = createRenameShip({ uow: racingShips(2), clock: core.clock, ids: newId });

    const results = await Promise.all([
      renameShip(argo, { shipId: scoutId, name: 'lookout' }),
      renameShip(argo, { shipId: otherId, name: 'lookout' }),
    ]);

    expect(results.map((result) => (result.isOk ? 'renamed' : result.error.kind)).sort()).toEqual([
      'SHIP_NAME_TAKEN',
      'renamed',
    ]);
    await expect(core.prisma.ship.count({ where: { name: 'lookout', retiredAt: null } })).resolves.toBe(1);
  });

  it('lets a rename and a commission racing for one name end with one ship of that name', async () => {
    const uow = racingShips(2);
    const deps = { uow, clock: core.clock, ids: newId };
    const commissionShip = createCommissionShip({
      ...deps,
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });

    const [renamed, commissioned] = await Promise.all([
      createRenameShip(deps)(argo, { shipId: scoutId, name: 'lookout' }),
      commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }),
    ]);

    expect([renamed.isOk, commissioned.isOk].filter(Boolean)).toHaveLength(1);
    await expect(core.prisma.ship.count({ where: { name: 'lookout', retiredAt: null } })).resolves.toBe(1);
  });
});
