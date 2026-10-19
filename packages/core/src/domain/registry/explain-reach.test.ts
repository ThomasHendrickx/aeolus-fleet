import {
  ANY_LABEL_VALUE,
  NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS,
  NETWORK_VERBS,
  SAME_LABEL_VALUE,
  type ExplainedReach,
  type LabelValueId,
  type NetworkRule,
  type NetworkVerb,
  type ReachRule,
  type ShipId,
  type WhileUnavailable,
} from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, hostedFleetWithViewer, initialiseFleet, operatorCaller, readReachOf, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { labelIdOf, valueIdOf } from '../../../test/support/label-fixtures.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { createExplainReach } from './explain-reach.js';

/**
 * argo asks whether one ship reaches another (design point 11 on #260):
 * planner (trust shared), scout (trust shared) and vault (trust sensitive),
 * labelled by argo; the rules come from the fleet's networking plugin.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let explainReach: ReturnType<typeof createExplainReach>;
let argo: ShipCaller;
let planner: ShipCaller;
let scout: ShipCaller;
let vault: ShipCaller;
let labeller: ShipCaller;
let networking: ShipCaller;

const SECOND = 1_000;
const NOT_RESPONDING_AFTER_SECONDS = NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS;

function value(text: string): LabelValueId {
  return valueIdOf(core, { key: 'trust', value: text });
}

/** Sets the rules as the networking plugin does: open for send off while rules apply, on for none, all-to-all. */
async function setRules(rules: NetworkRule[] | null): Promise<void> {
  unwrap(await registry.setNetworkRules(networking, { rules: rules ?? [] }));
  unwrap(await registry.setBuiltInRule(networking, { rule: 'open', verb: 'send', isOn: rules === null }));
}

/** Shared ships reach shared ships; nothing reaches vault. */
const sharedToShared = (): NetworkRule[] => [{ verb: 'send', from: [value('shared')], to: [value('shared')] }];

function byId(...ships: { shipId: ShipId }[]): ShipId[] {
  return ships.map((ship) => ship.shipId).sort();
}

/** The ships an explain answers for send, by id. */
function sendReach(explained: ExplainedReach): ShipId[] {
  return explained.send.map((reached) => reached.shipId);
}

/** The rule an explain names for the verb and the ship, or undefined when the ship is not reached by it. */
function ruleFor(explained: ExplainedReach, at: { verb: NetworkVerb; ship: { shipId: ShipId } }): ReachRule | undefined {
  return explained[at.verb].find((reached) => reached.shipId === at.ship.shipId)?.rule;
}

async function registerAs(whileUnavailable: WhileUnavailable): Promise<void> {
  unwrap(await registry.registerNetworkPlugin(networking, { whileUnavailable, notRespondingAfterSeconds: NOT_RESPONDING_AFTER_SECONDS }));
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-10T13:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  explainReach = createExplainReach({ uow: core.uow, clock: core.clock, readReach: readReachOf(core) });
  // argo labels the ships: it labels any ship (decision 0046).
  labeller = argo;
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

    expect(sendReach(explained)).toEqual(byId(argo, planner, vault, networking));
  });
});

describe('explaining reach under rules', () => {
  beforeEach(async () => {
    await setRules(sharedToShared());
  });

  it('answers the ships a rule lets the ship reach, and argo', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo, planner));
  });

  it('answers only argo for a ship no rule lets send', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: vault.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo));
  });

  it('answers every other ship from argo, who reaches every ship', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: argo.shipId }));

    expect(sendReach(explained)).toEqual(byId(planner, scout, vault, networking));
  });

  it('answers argo for every ship under an empty list, the fixed exception', async () => {
    await setRules([]);

    const explained = unwrap(await explainReach(argo, { fromShipId: planner.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo));
  });

  it('answers the ship asked about when the ship reaches it', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: planner.shipId }));

    expect(sendReach(explained)).toEqual([planner.shipId]);
  });

  it('answers none when the ship does not reach the ship asked about', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId }));

    expect(sendReach(explained)).toEqual([]);
  });

  it('reads the label values the ships carry now', async () => {
    unwrap(await registry.unassignLabel(labeller, { shipId: planner.shipId, valueId: value('shared') }));

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo));
  });

  it('leaves retired ships out', async () => {
    unwrap(await registry.retireShip(argo, { shipId: planner.shipId }));

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo));
  });

  it('records no reach refusal: an explain is not a send', async () => {
    await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId });

    expect(core.state.reachRefusals).toEqual([]);
  });
});

describe('explaining reach under rules with terms of any or the same value', () => {
  it('answers the ships carrying the label a term of any value asks, whatever its value', async () => {
    await setRules([{ verb: 'send', from: [value('shared')], to: [{ labelId: labelIdOf(core, 'trust'), value: ANY_LABEL_VALUE }] }]);

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo, planner, vault));
  });

  it('answers only the ships carrying the same value of the label a term of the same value asks', async () => {
    const same = { labelId: labelIdOf(core, 'trust'), value: SAME_LABEL_VALUE } as const;
    await setRules([{ verb: 'send', from: [same], to: [same] }]);

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo, planner));
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

    expect(sendReach(explained)).toEqual(byId(argo));
  });

  it('answers every other ship when the plugin declared open-all', async () => {
    await registerAs('open-all');
    await setRules(sharedToShared());
    pluginGoesQuiet();

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo, planner, vault, networking));
  });

  it('answers by the rules supplied last when the plugin declared keep-latest', async () => {
    await setRules(sharedToShared());
    pluginGoesQuiet();

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo, planner));
  });
});

describe('who explains reach (decision 0053)', () => {
  /** Shared ships read shared ships, and open read is off: planner reads planner and scout, never vault. */
  async function readRulesApply(): Promise<void> {
    unwrap(await registry.setNetworkRules(networking, { rules: [{ verb: 'read', from: [value('shared')], to: [value('shared')] }] }));
    unwrap(await registry.setBuiltInRule(networking, { rule: 'open', verb: 'read', isOn: false }));
  }

  it('lets any actor holding fleet:explain explain reach, not only argo', async () => {
    const explainer: ShipCaller = { ...planner, scopes: ['fleet:explain'] };

    const explained = unwrap(await explainReach(explainer, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo, planner, vault, networking));
  });

  it('answers only the ships the explaining actor reads', async () => {
    await readRulesApply();
    const explainer: ShipCaller = { ...planner, scopes: ['fleet:explain'] };

    const explained = unwrap(await explainReach(explainer, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual([planner.shipId]);
  });

  it('refuses to explain from a ship the explaining actor does not read', async () => {
    await readRulesApply();
    const explainer: ShipCaller = { ...planner, scopes: ['fleet:explain'] };

    expect(refusalOf(await explainReach(explainer, { fromShipId: vault.shipId }))).toEqual({
      kind: 'NOT_REACHABLE',
      message: 'The network rules do not let you read the ship to explain from',
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
    const hostedArgo: ShipCaller = { ...argo, fleetId: hosted.fleetId, shipId: hosted.operatorShipId };

    const explained = unwrap(await explainReach(hostedArgo, { fromShipId: hosted.operatorShipId }));

    expect(sendReach(explained)).toEqual([]);
  });

  /** argo of another fleet. */
  async function createFleetShip(): Promise<ShipId> {
    const other = await hostedFleetWithViewer(core);
    return other.operatorShipId;
  }
});

describe('the rule each reach names (decision 0034)', () => {
  /** Open off for every verb, as the networking plugin turns it while argo's rules apply. */
  async function openOff(): Promise<void> {
    for (const verb of NETWORK_VERBS) {
      unwrap(await registry.setBuiltInRule(networking, { rule: 'open', verb, isOn: false }));
    }
  }

  it('names argo for every ship argo reaches by every verb, and for argo by send and manage: a ship reads argo only by a rule (#866)', async () => {
    await setRules([]);
    await openOff();

    const fromArgo = unwrap(await explainReach(argo, { fromShipId: argo.shipId, toShipId: vault.shipId }));
    const toArgo = unwrap(await explainReach(argo, { fromShipId: vault.shipId, toShipId: argo.shipId }));

    expect([fromArgo, toArgo]).toEqual([
      { send: [{ shipId: vault.shipId, rule: { builtIn: 'argo' } }], read: [{ shipId: vault.shipId, rule: { builtIn: 'argo' } }], manage: [{ shipId: vault.shipId, rule: { builtIn: 'argo' } }] },
      { send: [{ shipId: argo.shipId, rule: { builtIn: 'argo' } }], read: [], manage: [{ shipId: argo.shipId, rule: { builtIn: 'argo' } }] },
    ]);
  });

  it("names the owner for the ships an owner's ship owns, by every verb, and not the other way", async () => {
    const { shipId: thomasId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    unwrap(await registry.setOwner(argo, { shipId: vault.shipId, ownerShipId: thomasId }));
    await setRules([]);
    await openOff();

    const fromOwner = unwrap(await explainReach(argo, { fromShipId: thomasId, toShipId: vault.shipId }));
    const toOwner = unwrap(await explainReach(argo, { fromShipId: vault.shipId, toShipId: thomasId }));

    expect(NETWORK_VERBS.map((verb) => ruleFor(fromOwner, { verb, ship: vault }))).toEqual([
      { builtIn: 'owner' },
      { builtIn: 'owner' },
      { builtIn: 'owner' },
    ]);
    expect(toOwner).toEqual({ send: [], read: [], manage: [] });
  });

  it('names open for every verb it is on for, and nothing once the plugin turns it off', async () => {
    unwrap(await registry.setBuiltInRule(networking, { rule: 'open', verb: 'manage', isOn: false }));

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId }));

    expect(explained).toEqual({ send: [{ shipId: vault.shipId, rule: { builtIn: 'open' } }], read: [{ shipId: vault.shipId, rule: { builtIn: 'open' } }], manage: [] });
  });

  it("names a rule the plugin supplied by its place in the fleet's list, for its verb only", async () => {
    await setRules([{ verb: 'send', from: [value('sensitive')], to: [] }, { verb: 'read', from: [value('shared')], to: [value('shared')] }]);
    await openOff();

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: planner.shipId }));

    expect(explained).toEqual({ send: [], read: [{ shipId: planner.shipId, rule: { plugin: 1 } }], manage: [] });
  });

  it('names a rule a ship declared by its declarer and its place in that ship\'s list', async () => {
    const trust = labelIdOf(core, 'trust');
    const declared: NetworkRule[] = [
      { verb: 'manage', from: [{ labelId: trust, value: ANY_LABEL_VALUE }], to: [] },
      { verb: 'send', from: [{ labelId: trust, value: SAME_LABEL_VALUE }], to: [{ labelId: trust, value: SAME_LABEL_VALUE }] },
    ];
    unwrap(await registry.declareNetworkRules(labeller, { rules: declared }));
    await setRules([{ verb: 'read', from: [], to: [] }, ...declared]);
    await openOff();

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: planner.shipId }));

    expect(explained).toEqual({
      send: [{ shipId: planner.shipId, rule: { declared: labeller.shipId, index: 1 } }],
      read: [{ shipId: planner.shipId, rule: { plugin: 0 } }],
      manage: [{ shipId: planner.shipId, rule: { declared: labeller.shipId, index: 0 } }],
    });
  });

  it('names the viewer reading for every ship the viewer reads, and open once argo turns it off', async () => {
    const hosted = await hostedFleetWithViewer(core);
    const hostedArgo: ShipCaller = { ...argo, fleetId: hosted.fleetId, shipId: hosted.operatorShipId };
    const { shipId: lookoutId } = unwrap(await registry.commissionShip(hostedArgo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
    const fromViewer = async () => unwrap(await explainReach(hostedArgo, { fromShipId: hosted.viewerShipId, toShipId: lookoutId }));

    expect(ruleFor(await fromViewer(), { verb: 'read', ship: { shipId: lookoutId } })).toEqual({ builtIn: 'viewerRead' });
    unwrap(await registry.setBuiltInRule(hostedArgo, { rule: 'viewerRead', isOn: false }));
    expect(ruleFor(await fromViewer(), { verb: 'read', ship: { shipId: lookoutId } })).toEqual({ builtIn: 'open' });
  });
});
