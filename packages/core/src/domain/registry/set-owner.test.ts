import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, everyShipMay, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
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

  it.each(['agent', 'app'] as const)('accepts an active %s as the direct owner', async (kind) => {
    // Given an eligible owner rooted at argo.
    const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer', kind }));
    core.state.events.length = 0;

    // When the owner changes.
    unwrap(await registry.setOwner(argo, { shipId: scoutId, ownerShipId: shipId }));

    // Then state and its event agree.
    expect(ownerOf(scoutId)).toBe(shipId);
    expect(core.state.events).toEqual([expect.objectContaining({ type: 'OwnerChanged', details: { fromShipId: argoId, toShipId: shipId, why: 'set' } })]);
  });

  it.each([1, 3])('refuses a loop of %i edges without state or event writes', async (edges) => {
    // Given a chain rooted at scout.
    let ownerShipId = scoutId;
    for (let index = 1; index < edges; index += 1) {
      const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: `child-${String(index)}`, type: 'worker' }));
      unwrap(await registry.setOwner(argo, { shipId, ownerShipId }));
      ownerShipId = shipId;
    }
    core.state.events.length = 0;
    const before = structuredClone(core.state.ships);

    // When scout would become its descendant's child.
    const result = await registry.setOwner(argo, { shipId: scoutId, ownerShipId });

    // Then no part of the assignment commits.
    expect(result).toMatchObject({ isOk: false, error: { kind: 'OWNERSHIP_CYCLE' } });
    expect(core.state.ships).toEqual(before);
    expect(core.state.events).toEqual([]);
  });

  it('refuses an owner in another fleet without writing an event', async () => {
    // Given a ship belonging to another fleet.
    const other = await initialiseFleet(createInMemoryCore('2027-01-01T00:00:00.000Z'));
    const foreign = core.ids('ship');
    const source = core.state.ships.find((ship) => ship.id === scoutId) ?? expect.fail('missing scout');
    core.state.ships.push({ ...source, id: foreign, fleetId: other.fleetId });

    // When it is named as owner.
    const result = await registry.setOwner(argo, { shipId: scoutId, ownerShipId: foreign });

    // Then it is absent from this fleet.
    expect(result).toMatchObject({ isOk: false, error: { kind: 'INVALID_OWNER' } });
    expect(core.state.events).toEqual([]);
  });

  it('refuses an already cyclic ancestor chain without state or event writes', async () => {
    // Given corrupt persisted ancestors, which are not person roots.
    const ship = core.state.ships.find((held) => held.id === scoutId) ?? expect.fail('missing scout');
    const first = core.ids('ship');
    const second = core.ids('ship');
    core.state.ships.push({ ...ship, id: first, name: 'first', owner: second }, { ...ship, id: second, name: 'second', owner: first });

    // When that chain is chosen for another ship.
    const result = await registry.setOwner(argo, { shipId: scoutId, ownerShipId: first });

    // Then repeated ancestors refuse and no assignment commits.
    expect(result).toMatchObject({ isOk: false, error: { kind: 'OWNERSHIP_CYCLE' } });
    expect(ownerOf(scoutId)).toBe(argoId);
    expect(core.state.events).toEqual([]);
  });

  it('refuses a fresh commission inheriting a cyclic owner chain', async () => {
    // Given an agent whose stored owner chain loops.
    const scout = core.state.ships.find((ship) => ship.id === scoutId) ?? expect.fail('missing scout');
    scout.owner = scoutId;
    const caller: ShipCaller = { kind: 'agent', fleetId: argo.fleetId, shipId: scoutId, scopes: ['fleet:commission'] };
    scout.scopes = ['messages:send', 'messages:receive', 'fleet:commission'];
    const before = structuredClone(core.state.ships);

    // When it commissions a ship with inherited ownership.
    const result = await registry.commissionShip(caller, { idempotencyKey: newKey(), name: 'helper', type: 'worker' });

    // Then neither a ship nor an event is stored.
    expect(result).toMatchObject({ isOk: false, error: { kind: 'OWNERSHIP_CYCLE' } });
    expect(core.state.ships).toEqual(before);
    expect(core.state.events).toEqual([]);
  });

  it.each(['plugin', 'trierarch', 'viewer'] as const)('refuses a %s as an owner without state or event writes', async (kind) => {
    // Given a ship of a kind outside the eligible owners.
    const scout = core.state.ships.find((ship) => ship.id === scoutId) ?? expect.fail('missing scout');
    const ownerShipId = core.ids('ship');
    core.state.ships.push({ ...scout, id: ownerShipId, name: kind, kind, owner: kind === 'viewer' ? null : argoId });

    // When it is named as owner.
    const result = await registry.setOwner(argo, { shipId: scoutId, ownerShipId });

    // Then the assignment is refused without writes.
    expect(result).toMatchObject({ isOk: false, error: { kind: 'INVALID_OWNER' } });
    expect(ownerOf(scoutId)).toBe(argoId);
    expect(core.state.events).toEqual([]);
    if (kind === 'viewer') {
      expect(await registry.setOwner(argo, { shipId: ownerShipId, ownerShipId: thomasId })).toMatchObject({ isOk: false, error: { kind: 'SHIP_HAS_NO_OWNER' } });
      expect(ownerOf(ownerShipId)).toBeNull();
    }
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

  it("refuses a person's ship, which owns itself, changing nothing and writing no event", async () => {
    const { shipId: charlotteId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'charlotte', type: 'person', kind: 'person' }));
    core.state.events.length = 0;

    const refused = await registry.setOwner(argo, { shipId: thomasId, ownerShipId: charlotteId });

    expect(refused).toEqual({ isOk: false, error: { kind: 'SHIP_OWNS_ITSELF', message: "thomas is a person's ship: it owns itself" } });
    expect(ownerOf(thomasId)).toBe(thomasId);
    expect(core.state.events).toEqual([]);
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
    await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: [everyShipMay('send'), everyShipMay('read')] });
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
