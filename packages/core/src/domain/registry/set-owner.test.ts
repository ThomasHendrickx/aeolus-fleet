import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: Caller;
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

describe("setting a ship's owner (decision 0045)", () => {
  it("makes a person's ship the owner, with OwnerChanged caused by argo", async () => {
    await expect(registry.setOwner(argo, { shipId: scoutId, ownerShipId: thomasId })).resolves.toEqual({ isOk: true, value: undefined });

    expect(ownerOf(scoutId)).toBe(thomasId);
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'OwnerChanged',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId: scoutId,
        details: { fromShipId: argoId, toShipId: thomasId, why: 'setByArgo' },
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

  it('refuses any caller but argo, changing nothing', async () => {
    const manager: Caller = { ...argo, shipId: scoutId, kind: 'agent' };

    await expect(registry.setOwner(manager, { shipId: scoutId, ownerShipId: thomasId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_THE_OPERATOR_SHIP' },
    });
    expect(ownerOf(scoutId)).toBe(argoId);
    expect(core.state.events).toEqual([]);
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
