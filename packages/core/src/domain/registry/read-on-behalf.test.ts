import { beforeEach, describe, expect, it } from 'vitest';

import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { Caller } from '../shared/caller.js';
import { createReadOnBehalf, type ReadOnBehalf } from './read-on-behalf.js';

let fleet: ReadReachScenario;
let plugin: Caller;
let readOnBehalf: ReadOnBehalf;

beforeEach(async () => {
  fleet = await readReachScenario();
  await fleet.readRulesApply();
  plugin = await shipWithScopes({ registry: fleet.registry, argo: fleet.argo }, { name: 'squadrons', type: 'squadrons', scopes: ['fleet:read', 'fleet:on-behalf'] });
  readOnBehalf = createReadOnBehalf({ ships: fleet.core.ships });
});

describe('reading on behalf of a named ship (decision 0034)', () => {
  it('reads as the named ship with fleet:read only, and keeps the plugin that asked', async () => {
    expect(unwrap(await readOnBehalf(plugin, { shipId: fleet.near.shipId }))).toEqual({
      fleetId: fleet.fleetId,
      shipId: fleet.near.shipId,
      kind: 'agent',
      scopes: ['fleet:read'],
      askedBy: plugin.shipId,
    });
  });

  it('never reads more than the named ship reads itself: the fleet and its events on behalf are its own', async () => {
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.near.shipId });
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });
    const onBehalf = unwrap(await readOnBehalf(plugin, { shipId: fleet.reader.shipId }));

    expect([await fleet.registry.listFleet(onBehalf), await fleet.registry.readFleetEvents(onBehalf, 0)]).toEqual([
      await fleet.registry.listFleet(fleet.reader),
      await fleet.registry.readFleetEvents(fleet.reader, 0),
    ]);
  });

  it("reads with the named ship's read reach whatever its own scopes: far outside it, reader whole", async () => {
    const onBehalf = unwrap(await readOnBehalf(plugin, { shipId: fleet.near.shipId }));

    const [far, reader] = [unwrap(await fleet.registry.getShip(onBehalf, { shipId: fleet.far.shipId })), unwrap(await fleet.registry.getShip(onBehalf, { shipId: fleet.reader.shipId }))];

    expect([far, 'owner' in reader]).toEqual([{ id: fleet.far.shipId, name: 'far', type: 'keeper', status: 'crewed', isInReadReach: false }, true]);
  });

  it('refuses to read on behalf of argo or the viewer, whose read is the whole fleet', async () => {
    const refusals = [refusalOf(await readOnBehalf(plugin, { shipId: fleet.argo.shipId })), refusalOf(await readOnBehalf(plugin, { shipId: fleet.viewer.shipId }))];

    expect(refusals.map((refusal) => refusal.kind)).toEqual(['SHIP_NOT_READ_ON_BEHALF', 'SHIP_NOT_READ_ON_BEHALF']);
  });

  it('refuses a ship it does not know, or a retired one, as not found', async () => {
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.far.shipId }));

    const refusals = [refusalOf(await readOnBehalf(plugin, { shipId: fleet.core.ids('ship') })), refusalOf(await readOnBehalf(plugin, { shipId: fleet.far.shipId }))];

    expect(refusals.map((refusal) => refusal.kind)).toEqual(['SHIP_NOT_FOUND', 'SHIP_NOT_FOUND']);
  });

  it('refuses a ship without fleet:on-behalf: fleet:read alone reads only as itself', async () => {
    expect(refusalOf(await readOnBehalf(fleet.reader, { shipId: fleet.near.shipId }))).toEqual({ kind: 'SCOPE_NOT_HELD', message: 'Reading on behalf of a ship needs the fleet:on-behalf scope' });
  });

  it('refuses a caller without fleet:read', async () => {
    const trierarch = await shipWithScopes({ registry: fleet.registry, argo: fleet.argo }, { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'] });

    expect(refusalOf(await readOnBehalf(trierarch, { shipId: fleet.near.shipId }))).toEqual({ kind: 'SCOPE_NOT_HELD', message: 'Reading on behalf of a ship needs the fleet:read scope' });
  });
});
