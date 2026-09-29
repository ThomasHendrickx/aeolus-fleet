import { createIdGenerator, type FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaOperatorAccountRepository } from '../src/adapters/prisma/identity.js';
import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import type { OperatorAccount } from '../src/core/identity/operator-account.js';
import { ok } from '../src/core/shared/result.js';
import { createMigratedDatabase } from './support/database.js';

// The operator account repository on a real Postgres: the email lookup that
// names no fleet, the fleet-scoped lookup, the password change and the lock.

const now = new Date('2026-09-29T12:00:00.000Z');
const newId = createIdGenerator();

let database: PrismaClient;

beforeAll(async () => {
  database = createPrismaClient(await createMigratedDatabase());
});

afterAll(async () => {
  await database.$disconnect();
});

async function createFleet(): Promise<FleetId> {
  const id = newId('fleet');
  await database.fleet.create({ data: { id, name: 'test fleet', createdAt: now } });
  return id;
}

async function anAccount(overrides: Partial<OperatorAccount> = {}): Promise<OperatorAccount> {
  return {
    id: newId('operator'),
    fleetId: await createFleet(),
    email: `${newId('operator')}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    createdAt: now,
    ...overrides,
  };
}

const accounts = () => createPrismaOperatorAccountRepository(database);

describe('the operator account repository', () => {
  it('stores an account and finds it by its email alone', async () => {
    const account = await anAccount();
    await accounts().create(account);

    await expect(accounts().findByEmailForUpdate(account.email)).resolves.toEqual(account);
  });

  it('finds no account for an email it does not hold', async () => {
    await accounts().create(await anAccount({ email: 'held@example.com' }));

    await expect(accounts().findByEmailForUpdate('other@example.com')).resolves.toBeUndefined();
  });

  it("finds the fleet's account", async () => {
    const account = await anAccount();
    await accounts().create(account);
    await accounts().create(await anAccount());

    await expect(accounts().findForFleetForUpdate(account.fleetId)).resolves.toEqual(account);
    await expect(accounts().findForFleetForUpdate(await createFleet())).resolves.toBeUndefined();
  });

  it("changes the password hash of the fleet's account only", async () => {
    const account = await anAccount();
    const other = await anAccount();
    await accounts().create(account);
    await accounts().create(other);

    await accounts().changePassword({ fleetId: account.fleetId, operatorId: account.id, passwordHash: 'new hash' });
    await accounts().changePassword({ fleetId: account.fleetId, operatorId: other.id, passwordHash: 'not this one' });

    await expect(accounts().findForFleetForUpdate(account.fleetId)).resolves.toMatchObject({ passwordHash: 'new hash' });
    await expect(accounts().findForFleetForUpdate(other.fleetId)).resolves.toMatchObject({
      passwordHash: other.passwordHash,
    });
  });

  it('holds the account locked until the unit of work ends', async () => {
    const account = await anAccount();
    await accounts().create(account);
    const uow = createPrismaUnitOfWork(database);
    const order: string[] = [];
    const { promise: firstHolds, resolve: releaseFirst } = Promise.withResolvers<undefined>();
    const { promise: firstLocked, resolve: signalLocked } = Promise.withResolvers<undefined>();

    const first = uow.run(async (tx) => {
      await tx.operatorAccounts.findByEmailForUpdate(account.email);
      order.push('first locked');
      signalLocked(undefined);
      await firstHolds;
      order.push('first done');
      return ok(undefined);
    });
    await firstLocked;
    const second = uow.run(async (tx) => {
      await tx.operatorAccounts.findForFleetForUpdate(account.fleetId);
      order.push('second locked');
      return ok(undefined);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    releaseFirst(undefined);
    await Promise.all([first, second]);

    expect(order).toEqual(['first locked', 'first done', 'second locked']);
  });
});
