import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import { accountIdSchema } from '@aeolus-fleet/common';

import type { AccountCaller, ShipCaller } from '../shared/caller.js';
import { newKey } from '../../testing/keys.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let argoId: ShipId;
let scoutId: ShipId;
let thomasId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T15:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argoId = fleet.operatorShipId;
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  ({ shipId: thomasId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function ownerOf(shipId: ShipId) {
  return core.state.ships.find((held) => held.id === shipId)?.owner;
}

describe("setting a ship's owner (decisions 0045, 0053)", () => {
  it("makes a person's ship the owner, with OwnerChanged caused by argo", async () => {
    await expect(registry.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId })).resolves.toEqual({ isOk: true, value: undefined });

    expect(ownerOf(scoutId)).toBe(thomasId);
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'OwnerChanged',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId: scoutId,
        details: { fromShipId: argoId, toShipId: thomasId, why: 'set' },
      }),
    ]);
  });

  it('makes argo the owner again', async () => {
    unwrap(await registry.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId }));

    unwrap(await registry.setOwner(argo, { shipId: scoutId, ownerShipId: argoId }));

    expect(ownerOf(scoutId)).toBe(argoId);
  });

  it('changes nothing and writes no event when the ship already has that owner', async () => {
    unwrap(await registry.setOwner(argo, { shipId: scoutId, ownerShipId: argoId }));

    expect(ownerOf(scoutId)).toBe(argoId);
    expect(core.state.events).toEqual([]);
  });

  it('lets any ship holding fleet:owner change an owner within its manage reach, the event naming it, not only argo', async () => {
    const { shipId: adminId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'admin', type: 'admin', scopes: ['fleet:owner'] }));
    const admin: ShipCaller = { fleetId: argo.fleetId, shipId: adminId, kind: 'agent', scopes: ['messages:send', 'messages:receive', 'fleet:owner'] };
    core.state.events.length = 0;

    unwrap(await registry.setOwner(admin, { shipId: scoutId, ownerShipId: thomasId }));

    expect(ownerOf(scoutId)).toBe(thomasId);
    expect(core.state.events.map(({ type, actor }) => ({ type, actor }))).toEqual([{ type: 'OwnerChanged', actor: { kind: 'ship', shipId: adminId } }]);
  });

  it('lets an account holding fleet:owner change an owner, the event naming the account by its id', async () => {
    const mathilde = accountIdSchema.parse('acc-mathilde');
    const account: AccountCaller = { kind: 'account', accountId: mathilde, fleetId: argo.fleetId, scopes: ['fleet:owner'], groupValues: [], personShipId: null, throughShipId: null };

    unwrap(await registry.setOwner(account, { shipId: scoutId, ownerShipId: thomasId }));

    expect(ownerOf(scoutId)).toBe(thomasId);
    expect(core.state.events.map(({ actor }) => actor)).toEqual([{ kind: 'account', accountId: mathilde, throughShipId: null }]);
  });

  it('refuses an owner that is an agent ship: an owner is a person or argo', async () => {
    const { shipId: lookoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));

    await expect(registry.setOwner(argo, { shipId: scoutId, ownerShipId: lookoutId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_OWNER' },
    });
    expect(ownerOf(scoutId)).toBe(argoId);
  });

  it('refuses a retired owner', async () => {
    unwrap(await registry.retireShip(argo, { shipId: thomasId }));

    await expect(registry.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_OWNER' },
    });
  });

  it('refuses an owner that does not exist', async () => {
    await expect(registry.setOwner(argo, { shipId: scoutId, ownerShipId: core.ids('ship') })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_OWNER' },
    });
  });

  it('refuses a ship that does not exist', async () => {
    await expect(registry.setOwner(argo, { shipId: core.ids('ship'), ownerShipId: thomasId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });

  it('refuses argo itself, which has no owner', async () => {
    await expect(registry.setOwner(argo, { shipId: argoId, ownerShipId: thomasId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_HAS_NO_OWNER' },
    });
  });

  it('refuses a retired ship', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scoutId }));

    await expect(registry.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_ALREADY_RETIRED' },
    });
  });
});

describe("setting an owner outside the actor's manage reach (decisions 0034, 0053)", () => {
  it('is refused as a manage the rules do not allow, recording the refusal and changing nothing', async () => {
    const fleet = await readReachScenario();
    const { shipId: personId } = unwrap(await fleet.registry.commissionShip(fleet.argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    unwrap(await fleet.registry.setBuiltInRule(fleet.networking, { rule: 'open', verb: 'manage', isOn: false }));
    fleet.core.state.reachRefusals.length = 0;
    const admin: ShipCaller = { ...fleet.near, scopes: ['fleet:owner'] };

    await expect(fleet.registry.setOwner(admin, { shipId: fleet.far.shipId, ownerShipId: personId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this manage' },
    });
    expect(fleet.core.state.ships.find((ship) => ship.id === fleet.far.shipId)?.owner).toBe(fleet.argo.shipId);
    expect(fleet.core.state.reachRefusals.map(({ verb }) => verb)).toEqual(['manage']);
  });
});
