import { beforeEach, describe, expect, it } from 'vitest';

import { readReachOf } from '../../../test/support/core-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { unwrap } from '../../../test/support/result.js';

// A plugin argo connected reads every ship of its fleet, whatever the rules
// (decision 0034): a built-in rule, never off, so saving rules cannot narrow
// it. A release or a retire of its ship ends it, and the fleet's registered
// networking plugin reads as a connected plugin does.

let fleet: ReadReachScenario;

beforeEach(async () => {
  fleet = await readReachScenario();
  await fleet.readRulesApply();
  fleet.core.state.events.length = 0;
});

async function readsOf(caller: ReadReachScenario['reader']) {
  return (await readReachOf(fleet.core)(caller)).kind;
}

function eventsOf(type: string) {
  return fleet.core.state.events.filter((event) => event.type === type);
}

describe('connecting a plugin (decision 0034)', () => {
  it('lets the ship argo connects read every ship, with PluginConnected caused by argo', async () => {
    await expect(readsOf(fleet.reader)).resolves.toBe('some');

    await expect(fleet.registry.connectPlugin(fleet.argo, { shipId: fleet.reader.shipId })).resolves.toEqual({ isOk: true, value: undefined });

    await expect(readsOf(fleet.reader)).resolves.toBe('every');
    expect(eventsOf('PluginConnected')).toEqual([
      expect.objectContaining({ occurredAt: fleet.core.clock.now(), actor: { kind: 'ship', shipId: fleet.argo.shipId }, shipId: fleet.reader.shipId, details: {} }),
    ]);
  });

  it('keeps a connected plugin reading every ship when the networking plugin saves rules that leave it out', async () => {
    unwrap(await fleet.registry.connectPlugin(fleet.argo, { shipId: fleet.reader.shipId }));

    unwrap(await fleet.registry.setNetworkRules(fleet.networking, { rules: [{ verb: 'read', from: [fleet.team('b')], to: [fleet.team('b')] }] }));

    await expect(readsOf(fleet.reader)).resolves.toBe('every');
  });

  it('names the built-in rule that lets a connected plugin read a ship', async () => {
    unwrap(await fleet.registry.connectPlugin(fleet.argo, { shipId: fleet.reader.shipId }));

    const { read } = unwrap(await fleet.registry.explainReach(fleet.argo, { fromShipId: fleet.reader.shipId, toShipId: fleet.far.shipId }));

    expect(read).toEqual([{ shipId: fleet.far.shipId, rule: { builtIn: 'pluginRead' } }]);
  });

  it('changes nothing and writes no event when the ship is connected already', async () => {
    unwrap(await fleet.registry.connectPlugin(fleet.argo, { shipId: fleet.reader.shipId }));

    unwrap(await fleet.registry.connectPlugin(fleet.argo, { shipId: fleet.reader.shipId }));

    expect(eventsOf('PluginConnected')).toHaveLength(1);
  });

  it('refuses any caller but argo, and connects nothing', async () => {
    await expect(fleet.registry.connectPlugin(fleet.reader, { shipId: fleet.reader.shipId })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR_SHIP' } });

    await expect(readsOf(fleet.reader)).resolves.toBe('some');
    expect(eventsOf('PluginConnected')).toEqual([]);
  });

  it("refuses argo's own ship and the viewer, which are no plugin's", async () => {
    for (const shipId of [fleet.argo.shipId, fleet.viewer.shipId]) {
      await expect(fleet.registry.connectPlugin(fleet.argo, { shipId })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_AGENT_SHIP' } });
    }
  });

  it('refuses a retired ship and a ship that does not exist', async () => {
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.far.shipId }));

    await expect(fleet.registry.connectPlugin(fleet.argo, { shipId: fleet.far.shipId })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_ALREADY_RETIRED' } });
    await expect(fleet.registry.connectPlugin(fleet.argo, { shipId: 'shp_01m3tbfspe96yf1rnr4ank9zzz' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });
});

describe("the end of a plugin's connection (decision 0034)", () => {
  beforeEach(async () => {
    unwrap(await fleet.registry.connectPlugin(fleet.argo, { shipId: fleet.reader.shipId }));
  });

  it('comes with a release of its ship, with PluginDisconnected: it reads by the rules again', async () => {
    unwrap(await fleet.registry.releaseShip(fleet.argo, { shipId: fleet.reader.shipId }));

    expect(eventsOf('PluginDisconnected')).toEqual([expect.objectContaining({ shipId: fleet.reader.shipId, details: { why: 'released' } })]);
    expect(fleet.core.state.pluginConnections).toEqual([]);
  });

  it('comes with argo crewing its ship again, which releases it', async () => {
    unwrap(await fleet.registry.recrewShip(fleet.argo, { shipId: fleet.reader.shipId }));

    expect(eventsOf('PluginDisconnected')).toEqual([expect.objectContaining({ shipId: fleet.reader.shipId, details: { why: 'released' } })]);
  });

  it('comes with the retire of its ship, with PluginDisconnected', async () => {
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.reader.shipId }));

    expect(eventsOf('PluginDisconnected')).toEqual([expect.objectContaining({ shipId: fleet.reader.shipId, details: { why: 'retired' } })]);
    expect(fleet.core.state.pluginConnections).toEqual([]);
  });
});

describe("the fleet's registered networking plugin (decision 0035)", () => {
  it('reads every ship as a connected plugin does, whatever its own rules', async () => {
    await expect(readsOf(fleet.networking)).resolves.toBe('every');
  });

});
