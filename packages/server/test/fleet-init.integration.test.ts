import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

let core: PostgresCore | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
});

describe('initialising the fleet on Postgres', () => {
  it('stores the fleet, argo, the hash of its secret and both events', async () => {
    core = await createPostgresCore();

    const { fleetId, operatorShipId, secret } = unwrap(
      await core.useCases.initialiseFleet({ name: 'home fleet' }),
    );

    await expect(core.prisma.fleet.findMany()).resolves.toEqual([
      { id: fleetId, name: 'home fleet', createdAt: core.clock.now() },
    ]);
    await expect(core.prisma.ship.findMany()).resolves.toEqual([
      expect.objectContaining({
        id: operatorShipId,
        fleetId,
        name: 'argo',
        type: 'operator',
        kind: 'operator',
        scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
        retiredAt: null,
      }),
    ]);
    await expect(core.prisma.credential.findMany()).resolves.toEqual([
      expect.objectContaining({ shipId: operatorShipId, secretHash: sha256Hasher.hash(secret), invalidatedAt: null }),
    ]);
    const events = await core.prisma.event.findMany({ orderBy: { id: 'asc' } });
    expect(events.map((event) => [event.type, event.actorShipId, event.shipId, event.details])).toEqual([
      ['FleetInitialised', null, null, { name: 'home fleet' }],
      ['ShipCommissioned', null, operatorShipId, { name: 'argo', type: 'operator', kind: 'operator' }],
    ]);
  });

  it('refuses a second run', async () => {
    core = await createPostgresCore();
    unwrap(await core.useCases.initialiseFleet({ name: 'home fleet' }));

    await expect(core.useCases.initialiseFleet({ name: 'second fleet' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'FLEET_ALREADY_EXISTS' },
    });
    await expect(core.prisma.fleet.count()).resolves.toBe(1);
    await expect(core.prisma.event.count()).resolves.toBe(2);
  });

  it('lets exactly one of several concurrent runs create a fleet', async () => {
    core = await createPostgresCore();
    const { initialiseFleet } = core.useCases;

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) => initialiseFleet({ name: `fleet ${String(index)}` })),
    );

    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    expect(results.flatMap((result) => (result.isOk ? [] : [result.error.kind]))).toEqual([
      'FLEET_ALREADY_EXISTS',
      'FLEET_ALREADY_EXISTS',
      'FLEET_ALREADY_EXISTS',
      'FLEET_ALREADY_EXISTS',
    ]);
    await expect(core.prisma.fleet.count()).resolves.toBe(1);
    await expect(core.prisma.ship.count()).resolves.toBe(1);
    await expect(core.prisma.credential.count()).resolves.toBe(1);
  });
});
