import { afterEach, describe, expect, it } from 'vitest';

import { argon2idPasswordHasher } from '../src/adapters/crypto/passwords.js';
import { OPERATOR } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

let core: PostgresCore | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
});

describe('initialising the fleet on Postgres', () => {
  it('stores the fleet, argo without a secret, and both events', async () => {
    core = await createPostgresCore();

    const { fleetId, operatorShipId, operatorId } = unwrap(
      await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }),
    );

    await expect(core.prisma.fleet.findMany()).resolves.toEqual([
      { id: fleetId, name: 'home fleet', createdAt: core.clock.now(), lastEventSeq: 2n, shipLimitSet: false, shipLimit: null, dailyMessageLimitSet: false, dailyMessageLimit: null },
    ]);
    await expect(core.prisma.ship.findMany()).resolves.toEqual([
      expect.objectContaining({
        id: operatorShipId,
        fleetId,
        name: 'argo',
        type: 'operator',
        kind: 'operator',
        scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'fleet:crew'],
        retiredAt: null,
      }),
    ]);
    await expect(core.prisma.credential.count()).resolves.toBe(0);
    const events = await core.prisma.event.findMany({ orderBy: { id: 'asc' } });
    expect(events.map((event) => [event.type, event.actorShipId, event.shipId, event.details])).toEqual([
      ['FleetInitialised', null, null, { name: 'home fleet', operatorId }],
      ['ShipCommissioned', null, operatorShipId, { name: 'argo', type: 'operator', kind: 'operator' }],
    ]);
  });

  it('stores the operator account with an Argon2id hash of the password, never the password', async () => {
    core = await createPostgresCore();

    const { fleetId, operatorId } = unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));

    const accounts = await core.prisma.operator.findMany();
    expect(accounts).toEqual([
      expect.objectContaining({ id: operatorId, fleetId, email: OPERATOR.email, createdAt: core.clock.now() }),
    ]);
    expect(accounts[0]?.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(argon2idPasswordHasher.verify(OPERATOR.password, accounts[0]?.passwordHash ?? undefined)).resolves.toBe(true);
    expect(JSON.stringify(accounts)).not.toContain(OPERATOR.password);
  });

  it('refuses a second run', async () => {
    core = await createPostgresCore();
    unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));

    await expect(core.useCases.initialiseFleet({ name: 'second fleet', ...OPERATOR })).resolves.toMatchObject({
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
      Array.from({ length: 5 }, (_, index) => initialiseFleet({ name: `fleet ${String(index)}`, ...OPERATOR })),
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
    await expect(core.prisma.credential.count()).resolves.toBe(0);
    await expect(core.prisma.operator.count()).resolves.toBe(1);
  });
});
