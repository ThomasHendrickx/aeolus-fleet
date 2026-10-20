import {
  ANY_LABEL_VALUE,
  NETWORK_VERBS,
  SAME_LABEL_VALUE,
  type ExplainedReach,
  type LabelValueId,
  type NetworkRule,
  type NetworkVerb,
  type ReachRule,
  type ShipId,
} from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, hostedFleetWithViewer, initialiseFleet, operatorCaller, readReachOf, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { labelIdOf, valueIdOf } from '../../../test/support/label-fixtures.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { InstallationCaller, ShipCaller } from '../shared/caller.js';
import { createExplainReach } from './explain-reach.js';

/**
 * argo asks whether one ship reaches another (design point 11 on #260):
 * planner (trust shared), scout (trust shared) and vault (trust sensitive),
 * labelled by argo; networking, holding fleet:network, applies the rules.
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

function value(text: string): LabelValueId {
  return valueIdOf(core, { key: 'trust', value: text });
}

/** Applies the rules: open is off while they apply, on for none, all-to-all. */
async function setRules(rules: NetworkRule[] | null): Promise<void> {
  await applyNetworkRules(registry, networking, rules);
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

describe('explaining reach of the draft (decision 0034)', () => {
  beforeEach(async () => {
    await setRules(sharedToShared());
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [{ verb: 'send', from: [value('shared')], to: [value('sensitive')] }] }));
  });

  it('answers by the draft when asked, as a send would be checked once it is applied', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, ofDraft: true }));

    expect(sendReach(explained)).toEqual(byId(argo, vault));
  });

  it('names a rule of the draft by its place in the draft', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId, ofDraft: true }));

    expect(explained.send).toEqual([{ shipId: vault.shipId, rule: { rule: 0 } }]);
  });

  it('answers by the applied rules otherwise', async () => {
    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId }));

    expect(sendReach(explained)).toEqual(byId(argo, planner));
  });

  it('answers open for a draft of none, all-to-all', async () => {
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: null }));

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId, ofDraft: true }));

    expect(explained.send).toEqual([{ shipId: vault.shipId, rule: { builtIn: 'open' } }]);
  });

  it('refuses the draft of a fleet without one', async () => {
    unwrap(await registry.discardNetworkRulesDraft(networking));

    expect(refusalOf(await explainReach(argo, { fromShipId: scout.shipId, ofDraft: true }))).toEqual({ kind: 'NO_NETWORK_RULES_DRAFT', message: 'The fleet has no draft of its network rules' });
  });
});

describe('who explains reach (decision 0053)', () => {
  /** Shared ships read shared ships, and open read is off: planner reads planner and scout, never vault. */
  async function readRulesApply(): Promise<void> {
    await setRules([{ verb: 'read', from: [value('shared')], to: [value('shared')] }]);
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
  it('names argo for every ship argo reaches by every verb, and for argo by send and manage: a ship reads argo only by a rule (#866)', async () => {
    await setRules([]);

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

    const fromOwner = unwrap(await explainReach(argo, { fromShipId: thomasId, toShipId: vault.shipId }));
    const toOwner = unwrap(await explainReach(argo, { fromShipId: vault.shipId, toShipId: thomasId }));

    expect(NETWORK_VERBS.map((verb) => ruleFor(fromOwner, { verb, ship: vault }))).toEqual([
      { builtIn: 'owner' },
      { builtIn: 'owner' },
      { builtIn: 'owner' },
    ]);
    expect(toOwner).toEqual({ send: [], read: [], manage: [] });
  });

  it('names open for every verb while the fleet has no rules applied, and nothing once it has', async () => {
    const open = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId }));
    await setRules([]);
    const closed = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: vault.shipId }));

    expect([open, closed]).toEqual([
      { send: [{ shipId: vault.shipId, rule: { builtIn: 'open' } }], read: [{ shipId: vault.shipId, rule: { builtIn: 'open' } }], manage: [{ shipId: vault.shipId, rule: { builtIn: 'open' } }] },
      { send: [], read: [], manage: [] },
    ]);
  });

  it("names an applied rule by its place in the fleet's list, for its verb only", async () => {
    await setRules([{ verb: 'send', from: [value('sensitive')], to: [] }, { verb: 'read', from: [value('shared')], to: [value('shared')] }]);

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: planner.shipId }));

    expect(explained).toEqual({ send: [], read: [{ shipId: planner.shipId, rule: { rule: 1 } }], manage: [] });
  });

  it('names a rule a ship declared by its declarer and its place in that ship\'s list, in force beside the applied ones (decision 0037)', async () => {
    const trust = labelIdOf(core, 'trust');
    const declared: NetworkRule[] = [
      { verb: 'manage', from: [{ labelId: trust, value: ANY_LABEL_VALUE }], to: [] },
      { verb: 'send', from: [{ labelId: trust, value: SAME_LABEL_VALUE }], to: [{ labelId: trust, value: SAME_LABEL_VALUE }] },
    ];
    unwrap(await registry.declareNetworkRules(labeller, { rules: declared }));
    await setRules([{ verb: 'read', from: [], to: [] }]);

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: planner.shipId }));

    expect(explained).toEqual({
      send: [{ shipId: planner.shipId, rule: { declared: { kind: 'ship', shipId: labeller.shipId }, index: 1 } }],
      read: [{ shipId: planner.shipId, rule: { rule: 0 } }],
      manage: [{ shipId: planner.shipId, rule: { declared: { kind: 'ship', shipId: labeller.shipId }, index: 0 } }],
    });
  });

  it('names a rule the installation declared by the installation and its place in its list', async () => {
    const installation: InstallationCaller = { kind: 'installation', fleetId: argo.fleetId, scopes: ['labels:define', 'labels:assign', 'labels:any', 'fleet:manage'] };
    const { labelId: group } = unwrap(await registry.defineLabel(installation, { key: 'group', values: ['sales'] }));
    const sales = valueIdOf(core, { key: 'group', value: 'sales' });
    unwrap(await registry.assignLabel(argo, { shipId: scout.shipId, valueId: sales }));
    unwrap(await registry.assignLabel(argo, { shipId: planner.shipId, valueId: sales }));
    const declared: NetworkRule[] = [{ verb: 'send', from: [{ labelId: group, value: SAME_LABEL_VALUE }], to: [{ labelId: group, value: SAME_LABEL_VALUE }] }];
    unwrap(await registry.declareNetworkRules(installation, { rules: declared }));
    await setRules([]);

    const explained = unwrap(await explainReach(argo, { fromShipId: scout.shipId, toShipId: planner.shipId }));

    expect(explained.send).toEqual([{ shipId: planner.shipId, rule: { declared: { kind: 'installation' }, index: 0 } }]);
  });

  it('names the viewer reading for every ship the viewer reads, and open once argo turns it off while no rules are applied', async () => {
    const hosted = await hostedFleetWithViewer(core);
    const hostedArgo: ShipCaller = { ...argo, fleetId: hosted.fleetId, shipId: hosted.operatorShipId };
    const { shipId: lookoutId } = unwrap(await registry.commissionShip(hostedArgo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' }));
    const fromViewer = async () => unwrap(await explainReach(hostedArgo, { fromShipId: hosted.viewerShipId, toShipId: lookoutId }));

    expect(ruleFor(await fromViewer(), { verb: 'read', ship: { shipId: lookoutId } })).toEqual({ builtIn: 'viewerRead' });
    unwrap(await registry.setBuiltInRule(hostedArgo, { rule: 'viewerRead', isOn: false }));
    expect(ruleFor(await fromViewer(), { verb: 'read', ship: { shipId: lookoutId } })).toEqual({ builtIn: 'open' });
  });
});
