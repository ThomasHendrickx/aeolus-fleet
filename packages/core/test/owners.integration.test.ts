import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cryptoRandomTokens, sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createCommissionShip } from '../src/domain/registry/commission-ship.js';
import type { Caller } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller } from './support/core-fixtures.js';
import { createPostgresCore, everyRow, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// Owners on a real Postgres (decision 0045): every ship but argo and the
// viewer has one, set and changed with its event in the same transaction.

const newId = createIdGenerator();

let core: PostgresCore;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
});

afterEach(async () => {
  await core.close();
});

/** The OwnerSet and OwnerChanged events about the ship, oldest first, as type and details. */
async function ownerEventsAbout(shipId: ShipId) {
  const events = await core.prisma.event.findMany({ where: { fleetId, shipId, type: { in: ['OwnerSet', 'OwnerChanged'] } }, orderBy: { id: 'asc' } });
  return events.map((event) => [event.type, event.details]);
}

async function ownerOf(shipId: ShipId) {
  return (await core.prisma.ship.findUniqueOrThrow({ where: { id: shipId } })).ownerShipId;
}

describe('the owner set at commission on Postgres', () => {
  it('stores argo as the owner of a ship argo commissions, with OwnerSet', async () => {
    const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));

    await expect(ownerOf(shipId)).resolves.toBe(argoId);
    await expect(ownerEventsAbout(shipId)).resolves.toEqual([['OwnerSet', { ownerShipId: argoId, how: 'argoByDefault' }]]);
  });

  it('stores nothing when its OwnerSet cannot be written', async () => {
    const before = await everyRow(core.prisma);
    const failingCommission = createCommissionShip({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(core.prisma).run((tx) =>
            work({
              ...tx,
              events: { append: (event) => (event.type === 'OwnerSet' ? Promise.reject(new Error('disk full')) : tx.events.append(event)) },
            }),
          ),
      },
      clock: core.clock,
      ids: newId,
      secrets: { hasher: sha256Hasher, random: cryptoRandomTokens },
    });

    await expect(failingCommission(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })).rejects.toThrow('disk full');

    await expect(everyRow(core.prisma)).resolves.toBe(before);
  });
});
