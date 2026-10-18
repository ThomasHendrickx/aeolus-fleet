import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { newKey } from '../../testing/keys.js';
import { idsOf, readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { unwrap } from '../../testing/result.js';
import type { Caller } from '../shared/caller.js';
import { createReadReachOf, readsEvent, readsMessage, readsShip, type ReadReach } from './read-reach.js';

let fleet: ReadReachScenario;
let readReachOf: ReturnType<typeof createReadReachOf>;

beforeEach(async () => {
  fleet = await readReachScenario();
  readReachOf = createReadReachOf({ uow: fleet.core.uow, clock: fleet.core.clock });
});

/** The ships of the fleet the reach reads, by id, sorted. */
function shipsRead(reach: ReadReach): ShipId[] {
  return fleet.core.state.ships
    .filter((ship) => readsShip(reach, ship.id))
    .map((ship) => ship.id)
    .sort();
}

function everyShip(): ShipId[] {
  return fleet.core.state.ships.map((ship) => ship.id).sort();
}

async function shipsReadBy(caller: Caller): Promise<ShipId[]> {
  return shipsRead(await readReachOf(caller));
}

describe('the ships a caller reads (decision 0034)', () => {
  it('reads every ship while open is on for read', async () => {
    await expect(shipsReadBy(fleet.reader)).resolves.toEqual(everyShip());
  });

  it('reads itself and the ships a read rule gives it once open is off for read, never argo or a ship outside', async () => {
    await fleet.readRulesApply();

    await expect(shipsReadBy(fleet.reader)).resolves.toEqual(idsOf(fleet.reader, fleet.near));
  });

  it('reads only itself when no rule gives it a ship', async () => {
    await fleet.readRulesApply();

    await expect(shipsReadBy(fleet.far)).resolves.toEqual(idsOf(fleet.far));
  });

  it("lets an owner's ship read the ships it owns, through the owner built-in", async () => {
    await fleet.readRulesApply();
    const { shipId: thomasId } = unwrap(await fleet.registry.commissionShip(fleet.argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    unwrap(await fleet.registry.setOwner(fleet.argo, { shipId: fleet.far.shipId, ownerShipId: thomasId }));

    await expect(shipsReadBy({ fleetId: fleet.fleetId, shipId: thomasId, kind: 'person', scopes: ['fleet:read'] })).resolves.toEqual([thomasId, fleet.far.shipId].sort());
  });

  it('reads a retired ship as it is now: a retire drops its labels, its owner still reads it', async () => {
    await fleet.readRulesApply();
    const { shipId: thomasId } = unwrap(await fleet.registry.commissionShip(fleet.argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    unwrap(await fleet.registry.setOwner(fleet.argo, { shipId: fleet.near.shipId, ownerShipId: thomasId }));
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.near.shipId }));

    expect([await shipsReadBy(fleet.reader), await shipsReadBy({ fleetId: fleet.fleetId, shipId: thomasId, kind: 'person', scopes: ['fleet:read'] })]).toEqual([
      idsOf(fleet.reader),
      [thomasId, fleet.near.shipId].sort(),
    ]);
  });

  it('lets argo read every ship whatever the rules', async () => {
    await fleet.readRulesApply();

    await expect(shipsReadBy(fleet.argo)).resolves.toEqual(everyShip());
  });

  it('lets the viewer read every ship through the viewer reading, and only itself once argo turns it off', async () => {
    await fleet.readRulesApply();
    const before = await shipsReadBy(fleet.viewer);
    unwrap(await fleet.registry.setBuiltInRule(fleet.argo, { rule: 'viewerRead', isOn: false }));

    expect([before, await shipsReadBy(fleet.viewer)]).toEqual([everyShip(), idsOf(fleet.viewer)]);
  });

  it('reads by the rules the plugin declared while it does not respond: block-all leaves only the built-ins', async () => {
    unwrap(await fleet.registry.registerNetworkPlugin(fleet.networking, { whileUnavailable: 'block-all', notRespondingAfterSeconds: 60 }));
    await fleet.readRulesApply();
    fleet.core.clock.advance(61_000);

    await expect(shipsReadBy(fleet.reader)).resolves.toEqual(idsOf(fleet.reader));
  });
});

describe('the messages a caller reads: through their sender or their recipient (decision 0034)', () => {
  beforeEach(async () => {
    await fleet.readRulesApply();
  });

  it('reads a message from a ship it reads, and one to a ship it reads', async () => {
    const reach = await readReachOf(fleet.reader);

    expect([
      readsMessage(reach, { senderId: fleet.near.shipId, recipient: { kind: 'ship', shipId: fleet.far.shipId }, claimedBy: null }),
      readsMessage(reach, { senderId: fleet.far.shipId, recipient: { kind: 'ship', shipId: fleet.near.shipId }, claimedBy: null }),
    ]).toEqual([true, true]);
  });

  it('does not read a message between two ships it does not read', async () => {
    const reach = await readReachOf(fleet.reader);

    expect(readsMessage(reach, { senderId: fleet.far.shipId, recipient: { kind: 'ship', shipId: fleet.argo.shipId }, claimedBy: null })).toBe(false);
  });

  it('reads a message to a type through the ship that claimed it, and not through the type once a ship outside claimed it', async () => {
    const reach = await readReachOf(fleet.reader);

    expect([
      readsMessage(reach, { senderId: fleet.far.shipId, recipient: { kind: 'type', type: 'keeper' }, claimedBy: fleet.near.shipId }),
      readsMessage(reach, { senderId: fleet.far.shipId, recipient: { kind: 'type', type: 'reviewer' }, claimedBy: fleet.far.shipId }),
    ]).toEqual([true, false]);
  });

  it('reads an unclaimed message to a type through any active ship of the type it reads', async () => {
    const reach = await readReachOf(fleet.reader);

    expect([
      readsMessage(reach, { senderId: fleet.far.shipId, recipient: { kind: 'type', type: 'reviewer' }, claimedBy: null }),
      readsMessage(reach, { senderId: fleet.far.shipId, recipient: { kind: 'type', type: 'keeper' }, claimedBy: null }),
    ]).toEqual([true, false]);
  });

  it('does not read an unclaimed message to a type through a retired ship of it', async () => {
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.near.shipId }));
    const reach = await readReachOf(fleet.reader);

    expect(readsMessage(reach, { senderId: fleet.far.shipId, recipient: { kind: 'type', type: 'reviewer' }, claimedBy: null })).toBe(false);
  });

  it('lets argo read every message', async () => {
    const reach = await readReachOf(fleet.argo);

    expect(readsMessage(reach, { senderId: fleet.far.shipId, recipient: { kind: 'type', type: 'nobody' }, claimedBy: null })).toBe(true);
  });

  it('reads its own messages, to and from argo too', async () => {
    const { shipId: nobody } = unwrap(await fleet.registry.commissionShip(fleet.argo, { idempotencyKey: newKey(), name: 'nobody', type: 'nobody' }));
    const reach = await readReachOf(fleet.far);

    expect([
      readsMessage(reach, { senderId: fleet.argo.shipId, recipient: { kind: 'ship', shipId: fleet.far.shipId }, claimedBy: null }),
      readsMessage(reach, { senderId: fleet.far.shipId, recipient: { kind: 'ship', shipId: fleet.argo.shipId }, claimedBy: null }),
      readsMessage(reach, { senderId: fleet.argo.shipId, recipient: { kind: 'ship', shipId: nobody }, claimedBy: null }),
    ]).toEqual([true, true, false]);
  });
});

describe('the events a caller reads (decision 0034)', () => {
  beforeEach(async () => {
    await fleet.readRulesApply();
  });

  it('reads an event about a ship only through that ship', async () => {
    const reach = await readReachOf(fleet.reader);

    expect([
      readsEvent(reach, { type: 'ShipRenamed', shipId: fleet.near.shipId, message: null }),
      readsEvent(reach, { type: 'ShipRenamed', shipId: fleet.far.shipId, message: null }),
    ]).toEqual([true, false]);
  });

  it.each(['NetworkRulesDeclared', 'NetworkRulesSet', 'BuiltInRuleChanged'] as const)('reads %s whatever ship it names: a rules event concerns no ship', async (type) => {
    const reach = await readReachOf(fleet.reader);

    expect(readsEvent(reach, { type, shipId: fleet.far.shipId, message: null })).toBe(true);
  });
});
