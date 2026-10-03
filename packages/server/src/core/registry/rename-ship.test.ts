import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let argoId: ShipId;
let scoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T15:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function ship(shipId: ShipId) {
  return core.state.ships.find((held) => held.id === shipId);
}

describe('renaming a ship', () => {
  it('gives the ship its new name, keeping its id and type', async () => {
    await expect(registry.renameShip(argo, { shipId: scoutId, name: 'lookout' })).resolves.toEqual({
      isOk: true,
      value: undefined,
    });
    expect(ship(scoutId)).toMatchObject({ id: scoutId, name: 'lookout', type: 'reviewer' });
  });

  it('writes ShipRenamed, caused by the operator, with the name it had and the name it has', async () => {
    unwrap(await registry.renameShip(argo, { shipId: scoutId, name: 'lookout' }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'ShipRenamed',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId: scoutId,
        details: { from: 'scout', to: 'lookout' },
      }),
    ]);
  });

  it('renames a crewed ship too: its session keeps crewing it', async () => {
    const crew = crewAboard(core, { fleetId, shipId: scoutId });

    unwrap(await registry.renameShip(argo, { shipId: scoutId, name: 'lookout' }));
    expect(core.state.leases.find((lease) => lease.id === crew.leaseId)?.endedAt).toBeNull();
  });

  it('frees the old name: a send to it no longer resolves, a send to the new one does', async () => {
    unwrap(await registry.renameShip(argo, { shipId: scoutId, name: 'lookout' }));
    const { sendMessage } = messagingUseCases(core);
    const send = (name: string) =>
      sendMessage(argo, { selector: { kind: 'ship', name }, payload: 'hi', idempotencyKey: `hi-${name}` });

    await expect(send('scout')).resolves.toMatchObject({ isOk: false, error: { kind: 'UNRESOLVABLE_SELECTOR' } });
    await expect(send('lookout')).resolves.toMatchObject({ isOk: true });
  });

  it('keeps the name it has as OK, and writes nothing', async () => {
    await expect(registry.renameShip(argo, { shipId: scoutId, name: 'scout' })).resolves.toEqual({ isOk: true, value: undefined });
    expect(core.state.events).toEqual([]);
  });

  it('refuses a name another active ship holds', async () => {
    unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));

    await expect(registry.renameShip(argo, { shipId: scoutId, name: 'lookout' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NAME_TAKEN' },
    });
    expect(ship(scoutId)?.name).toBe('scout');
  });

  it('takes the name of a retired ship: names are reusable after retirement', async () => {
    const { shipId: oldId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
    unwrap(await registry.retireShip(argo, { shipId: oldId }));

    unwrap(await registry.renameShip(argo, { shipId: scoutId, name: 'lookout' }));
    expect(ship(scoutId)?.name).toBe('lookout');
  });

  it.each([
    ['', 'INVALID_SHIP_NAME'],
    ['Scout', 'INVALID_SHIP_NAME'],
    ['a'.repeat(49), 'INVALID_SHIP_NAME'],
    ['argo', 'SHIP_NAME_RESERVED'],
  ])('refuses the name %j (%s)', async (name, kind) => {
    await expect(registry.renameShip(argo, { shipId: scoutId, name })).resolves.toMatchObject({ isOk: false, error: { kind } });
  });

  it('takes a name of 48 characters exactly', async () => {
    unwrap(await registry.renameShip(argo, { shipId: scoutId, name: 'a'.repeat(48) }));
    expect(ship(scoutId)?.name).toBe('a'.repeat(48));
  });

  it('refuses to rename argo', async () => {
    await expect(registry.renameShip(argo, { shipId: argoId, name: 'helm' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'OPERATOR_SHIP_IS_PERMANENT' },
    });
  });

  it('refuses to rename a retired ship', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scoutId }));

    await expect(registry.renameShip(argo, { shipId: scoutId, name: 'lookout' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_ALREADY_RETIRED' },
    });
  });

  it('refuses a ship the fleet does not have', async () => {
    await expect(registry.renameShip(argo, { shipId: core.ids('ship'), name: 'lookout' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
  });
});
