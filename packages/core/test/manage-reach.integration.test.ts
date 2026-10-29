import type { FleetScope, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { createTestClock } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';
import { withOperatorLogin } from './support/operator-login.js';

// Manage reach on Postgres (decision 0034): manager, with fleet:manage, and
// near carry team a; far carries team b; the applied manage rule lets team a
// manage team a, and every ship still sends to and reads every ship.

const clock = createTestClock('2026-10-18T09:00:00.000Z');

let database: PrismaClient;
let useCases: UseCases;
let argo: ShipCaller;
let manager: ShipCaller;
let assign: (shipId: ShipId, value: 'a' | 'b') => Promise<void>;

async function crewed(ship: { name: string; type: string; scopes?: FleetScope[] }): Promise<{ shipId: ShipId; caller: ShipCaller }> {
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: ship.name, type: ship.type, scopes: ship.scopes ?? [] }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return { shipId, caller: unwrap(await useCases.authenticate.byCrewToken(crewToken)) };
}

/** A ship of team a or b, awaiting crew. */
async function shipOf(name: string, value: 'a' | 'b'): Promise<ShipId> {
  const { shipId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'keeper' }));
  await assign(shipId, value);
  return shipId;
}

beforeAll(async () => {
  database = createPrismaClient(await createMigratedDatabase());
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' }))));
  // argo labels the ships: it labels any ship (decision 0046).
  const labeller = { caller: argo };
  const networking = await crewed({ name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  const team = unwrap(await useCases.defineLabel(labeller.caller, { key: 'team', values: ['a', 'b'] }));
  assign = async (shipId, value) => {
    const valueId = team.values.find((each) => each.value === value)?.id;
    if (valueId === undefined) {
      throw new Error(`the team label has no value ${value}`);
    }
    unwrap(await useCases.assignLabel(labeller.caller, { shipId, valueId }));
  };
  const managerShip = await crewed({ name: 'manager', type: 'manager', scopes: ['fleet:manage'] });
  manager = managerShip.caller;
  await assign(managerShip.shipId, 'a');
  const teamA = team.values.find((each) => each.value === 'a')?.id;
  if (teamA === undefined) {
    throw new Error('the team label has no value a');
  }
  const { savedAgainstVersion } = unwrap(await useCases.saveNetworkRulesDraft(networking.caller, { rules: [{ verb: 'manage', from: [teamA], to: [teamA] }, { verb: 'send', from: [], to: [] }, { verb: 'read', from: [], to: [] }] }));
  unwrap(await useCases.applyNetworkRules(networking.caller, { version: savedAgainstVersion }));
});

afterAll(async () => {
  await database.$disconnect();
});

describe('manage reach on Postgres', () => {
  it('refuses a rename outside manage reach, keeping the name, and keeps the refusal on record with the verb manage', async () => {
    const far = await shipOf('far-renamed', 'b');

    await expect(useCases.renameShip(manager, { shipId: far, name: 'renamed' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE' } });

    await expect(database.ship.findUniqueOrThrow({ where: { id: far }, select: { name: true } })).resolves.toEqual({ name: 'far-renamed' });
    const refusals = await database.reachRefusal.findMany({ where: { verb: 'manage' } });
    expect(refusals.map(({ recipient }) => JSON.stringify(recipient)).some((recipient) => recipient.includes(far))).toBe(true);
  });

  it('refuses a retire outside manage reach, leaving the ship active, and keeps the refusal on record', async () => {
    const far = await shipOf('far-retired', 'b');
    const before = await database.reachRefusal.count({ where: { verb: 'manage' } });

    await expect(useCases.retireShip(manager, { shipId: far })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE' } });

    await expect(database.ship.findUniqueOrThrow({ where: { id: far }, select: { retiredAt: true } })).resolves.toEqual({ retiredAt: null });
    await expect(database.reachRefusal.count({ where: { verb: 'manage' } })).resolves.toBe(before + 1);
  });

  it('retires two ships within manage reach at once: neither waits on the other for good', async () => {
    const [first, second] = [await shipOf('near-first', 'a'), await shipOf('near-second', 'a')];

    const retired = await Promise.all([useCases.retireShip(manager, { shipId: first }), useCases.retireShip(manager, { shipId: second })]);

    expect(retired.map((result) => result.isOk)).toEqual([true, true]);
  });
});
