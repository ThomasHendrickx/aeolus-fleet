import { NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS, type LabelValueId, type NetworkRule, type ShipId, type WhileUnavailable } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, hostedFleetWithViewer, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createExplainReach } from './explain-reach.js';

/**
 * argo asks whether one ship reaches another (design point 11 on #260):
 * planner (trust shared), scout (trust shared) and vault (trust sensitive),
 * labelled by the labeller; the rules come from the fleet's networking plugin.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let explainReach: ReturnType<typeof createExplainReach>;
let argo: Caller;
let planner: Caller;
let scout: Caller;
let vault: Caller;
let labeller: Caller;
let networking: Caller;

const SECOND = 1_000;
const NOT_RESPONDING_AFTER_SECONDS = NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS;

function value(text: string): LabelValueId {
  return valueIdOf(core, { key: 'trust', value: text });
}

async function setRules(rules: NetworkRule[] | null): Promise<void> {
  unwrap(await registry.setNetworkRules(networking, { rules }));
}

/** Shared ships reach shared ships; nothing reaches vault. */
const sharedToShared = (): NetworkRule[] => [{ from: [value('shared')], to: [value('shared')] }];

function byId(...ships: { shipId: ShipId }[]): ShipId[] {
  return ships.map((ship) => ship.shipId).sort();
}

async function registerAs(whileUnavailable: WhileUnavailable): Promise<void> {
  unwrap(await registry.registerNetworkPlugin(networking, { whileUnavailable, notRespondingAfterSeconds: NOT_RESPONDING_AFTER_SECONDS }));
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-10T13:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  explainReach = createExplainReach({ uow: core.uow, clock: core.clock });
  labeller = await shipWithScopes({ registry, argo }, { name: 'labeller', type: 'labeller', scopes: ['labels:define', 'labels:assign'] });
  planner = await shipWithScopes({ registry, argo }, { name: 'planner', type: 'planner', scopes: [] });
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'keeper', scopes: [] });
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  crewAboard(core, networking);
  await registerAs('keep-latest');
  unwrap(await registry.defineLabel(labeller, { key: 'trust', values: ['shared', 'sensitive'] }));
  for (const [ship, text] of [
    [planner, 'shared'],
    [scout, 'shared'],
    [vault, 'sensitive'],
  ] as const) {
    unwrap(await registry.assignLabel(labeller, { shipId: ship.shipId, valueId: value(text) }));
  }
});

describe('explaining reach while the fleet has no rules', () => {
  it('answers every other ship of the fleet, all-to-all', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(argo, labeller, planner, vault, networking));
  });
});

describe('explaining reach under rules', () => {
  beforeEach(async () => {
    await setRules(sharedToShared());
  });

  it('answers the ships a rule lets the ship reach, and argo', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(argo, planner));
  });

  it('answers only argo for a ship no rule lets send', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: vault.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(argo));
  });

  it('answers every other ship from argo, who reaches every ship', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: argo.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(labeller, planner, scout, vault, networking));
  });

  it('answers argo for every ship under an empty list, the fixed exception', async () => {
    await setRules([]);

    const explained = unwrap(await explainReach(argo, { fromShipId: planner.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(argo));
  });

  it('answers the ship asked about when the ship reaches it', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: planner.shipId }));

    expect(explained.reachableShipIds).toEqual([planner.shipId]);
  });

  it('answers none when the ship does not reach the ship asked about', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId }));

    expect(explained.reachableShipIds).toEqual([]);
  });

  it('reads the label values the ships carry now', async () => {
    unwrap(await registry.unassignLabel(labeller, { shipId: planner.shipId, valueId: value('shared') }));

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(argo));
  });

  it('leaves retired ships out', async () => {
    unwrap(await registry.retireShip(argo, { shipId: planner.shipId }));

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(argo));
  });

  it('records no reach refusal: an explain is not a send', async () => {
    await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId });

    expect(core.state.reachRefusals).toEqual([]);
  });
});

describe('explaining reach while the networking plugin is not responding', () => {
  function pluginGoesQuiet(): void {
    core.clock.advance((NOT_RESPONDING_AFTER_SECONDS + 1) * SECOND);
  }

  it('answers only argo when the plugin declared block-all', async () => {
    await registerAs('block-all');
    await setRules(sharedToShared());
    pluginGoesQuiet();

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(argo));
  });

  it('answers every other ship when the plugin declared open-all', async () => {
    await registerAs('open-all');
    await setRules(sharedToShared());
    pluginGoesQuiet();

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(argo, labeller, planner, vault, networking));
  });

  it('answers by the rules supplied last when the plugin declared keep-latest', async () => {
    await setRules(sharedToShared());
    pluginGoesQuiet();

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(explained.reachableShipIds).toEqual(byId(argo, planner));
  });
});

describe('who explains reach', () => {
  it('refuses a ship that is not argo, even the networking plugin', async () => {
    expect(refusalOf(await explainReach(networking, { fromShipId: scout.shipId }))).toEqual({
      kind: 'NOT_THE_OPERATOR_SHIP',
      message: 'Only argo explains reach',
    });
  });
});

describe('the ships an explain names', () => {
  it('refuses a ship the fleet does not have', async () => {
    const other = await createFleetShip();

    expect(refusalOf(await explainReach(argo, { fromShipId: other })).kind).toBe('SHIP_NOT_FOUND');
  });

  it('refuses a retired ship to explain from', async () => {
    unwrap(await registry.retireShip(argo, { shipId: scout.shipId }));

    expect(refusalOf(await explainReach(argo, { fromShipId: scout.shipId })).kind).toBe('SHIP_NOT_FOUND');
  });

  it('refuses a ship asked about that the fleet does not have', async () => {
    const other = await createFleetShip();

    expect(refusalOf(await explainReach(argo, { fromShipId: scout.shipId, toShipId: other })).kind).toBe('SHIP_NOT_FOUND');
  });

  it('refuses a retired ship asked about', async () => {
    unwrap(await registry.retireShip(argo, { shipId: vault.shipId }));

    expect(refusalOf(await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId })).kind).toBe('SHIP_NOT_FOUND');
  });

  it("leaves the fleet's viewer ship out, as it receives nothing", async () => {
    const hosted = await hostedFleetWithViewer(core);
    const hostedArgo: Caller = { ...argo, fleetId: hosted.fleetId, shipId: hosted.operatorShipId };

    const explained = unwrap(await explainReach(hostedArgo, { fromShipId: hosted.operatorShipId }));

    expect(explained.reachableShipIds).toEqual([]);
  });

  /** argo of another fleet. */
  async function createFleetShip(): Promise<ShipId> {
    const other = await hostedFleetWithViewer(core);
    return other.operatorShipId;
  }
});
