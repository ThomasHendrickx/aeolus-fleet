import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, crewAboard, readReachOf } from '../../../test/support/core-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew } from '../shared/caller.js';

// A plugin ship reads every ship of its fleet, whatever the rules, by its kind
// (decision 0050): a built-in rule, never off, so saving rules cannot narrow
// it. A release ends nothing; only a retire of its ship ends it.

let fleet: ReadReachScenario;
let plugin: Crew;

beforeEach(async () => {
  fleet = await readReachScenario();
  await fleet.readRulesApply();
  const { shipId } = unwrap(await fleet.registry.commissionShip(fleet.argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', kind: 'plugin', scopes: ['fleet:read'] }));
  plugin = { ...crewAboard(fleet.core, { fleetId: fleet.fleetId, shipId }), kind: 'plugin', scopes: ['messages:send', 'messages:receive', 'fleet:read'] };
  fleet.core.state.events.length = 0;
});

async function readsOf(caller: Crew) {
  return (await readReachOf(fleet.core)(caller)).kind;
}

function eventsOf(type: string) {
  return fleet.core.state.events.filter((event) => event.type === type);
}

describe('the read of a plugin ship (decision 0050)', () => {
  it('reads every ship by its kind, where an agent ship with fleet:read reads by the rules', async () => {
    await expect(readsOf(plugin)).resolves.toBe('every');
    await expect(readsOf(fleet.reader)).resolves.toBe('some');
  });

  it('keeps reading every ship when the fleet applies rules that leave it out', async () => {
    await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: [{ verb: 'read', from: [fleet.team('b')], to: [fleet.team('b')] }] });

    await expect(readsOf(plugin)).resolves.toBe('every');
  });

  it('names the built-in rule that lets a plugin ship read a ship', async () => {
    const { read } = unwrap(await fleet.registry.explainReach(fleet.argo, { fromShipId: plugin.shipId, toShipId: fleet.far.shipId }));

    expect(read).toEqual([{ shipId: fleet.far.shipId, rule: { builtIn: 'pluginRead' } }]);
  });

  it('outlasts a release of its ship: crewed again, it reads every ship, and no PluginDisconnected', async () => {
    unwrap(await fleet.registry.releaseShip(fleet.argo, { shipId: plugin.shipId }));
    const crewedAgain: Crew = { ...crewAboard(fleet.core, plugin), kind: 'plugin', scopes: plugin.scopes };

    await expect(readsOf(crewedAgain)).resolves.toBe('every');
    expect(eventsOf('PluginDisconnected')).toEqual([]);
  });

  it('ends with the retire of its ship, with PluginDisconnected', async () => {
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: plugin.shipId }));

    expect(eventsOf('PluginDisconnected')).toEqual([expect.objectContaining({ shipId: plugin.shipId, details: { why: 'retired' } })]);
  });

  it('writes no PluginDisconnected for the retire of an agent ship', async () => {
    unwrap(await fleet.registry.retireShip(fleet.argo, { shipId: fleet.reader.shipId }));

    expect(eventsOf('PluginDisconnected')).toEqual([]);
  });
});
