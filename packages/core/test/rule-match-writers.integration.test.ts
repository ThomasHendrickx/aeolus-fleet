import { idSchema, type FleetId, type LabelId, type LabelValueId, type NetworkRule, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaDeclaredNetworkRulesRepository, createPrismaNetworkSettingsRepository } from '../src/adapters/prisma/network.js';
import { createPrismaRuleMatchRepository, sourceText } from '../src/adapters/prisma/rule-matches.js';
import { ruleMatchesOf, ruleSourcesOf, type RuleMatch } from '../src/domain/registry/rule-matches.js';
import type { InstallationCaller, ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { aPersonReadFleet } from './support/person-read-postgres.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// Q4 of rule-matches.md: after every writer commits, the stored rule matches
// equal a fresh computation from the authoritative tables.

let core: PostgresCore;
beforeAll(async () => {
  core = await createPostgresCore();
});
afterAll(async () => {
  await core.close();
});

const shipRowSchema = z.object({ id: idSchema('ship'), owner: idSchema('ship').nullable() });
const carriedRowSchema = z.object({ shipId: idSchema('ship'), labelId: idSchema('label'), valueId: idSchema('labelValue'), declarer: idSchema('ship').nullable() });

const order = (matches: readonly RuleMatch[]) =>
  matches.map((match) => ({ ...match, source: sourceText(match.source) })).sort((one, other) => `${one.shipId}|${one.verb}|${one.source}`.localeCompare(`${other.shipId}|${other.verb}|${other.source}`));

async function freshRuleMatchesOf(fleetId: FleetId): Promise<RuleMatch[]> {
  const settings = await createPrismaNetworkSettingsRepository(core.prisma).find(fleetId);
  const declared = await createPrismaDeclaredNetworkRulesRepository(core.prisma).list(fleetId);
  const ships = z.array(shipRowSchema).parse(await core.prisma.$queryRaw`
    SELECT id, owner_ship_id AS owner FROM ships WHERE fleet_id = ${fleetId} AND retired_at IS NULL AND removed_at IS NULL`);
  const carried = z.array(carriedRowSchema).parse(await core.prisma.$queryRaw`
    SELECT sl.ship_id AS "shipId", sl.label_id AS "labelId", sl.value_id AS "valueId", l.owner_ship_id AS declarer
    FROM ship_labels sl JOIN labels l ON l.fleet_id = sl.fleet_id AND l.id = sl.label_id WHERE sl.fleet_id = ${fleetId}`);
  const inForce = { rules: settings.rules ?? [], declared };
  return ships.flatMap((ship) => {
    const own = carried.filter((value) => value.shipId === ship.id);
    const declarers = new Set(own.flatMap(({ declarer }) => (declarer === null ? [] : [declarer])));
    return ruleMatchesOf({ id: ship.id, owner: ship.owner, labels: own.map(({ labelId, valueId }) => ({ labelId, valueId })) }, ruleSourcesOf(inForce, declarers));
  });
}

async function storedRuleMatchesOf(fleetId: FleetId): Promise<RuleMatch[]> {
  return createPrismaRuleMatchRepository(core.prisma).list(fleetId);
}

async function expectRuleMatchesKept(fleetId: FleetId): Promise<void> {
  expect(order(await storedRuleMatchesOf(fleetId))).toEqual(order(await freshRuleMatchesOf(fleetId)));
}

/** A closed fleet with own, installation and ship-declared rules, labels of each owner carried, and a person ship owning a ship. */
async function aMatchedFleet() {
  const fleet = await aPersonReadFleet(core);
  const { argo, fleetId } = fleet;
  const declarerShip = await fleet.commission({ name: 'declarer', scopes: ['labels:define', 'labels:assign', 'fleet:commission'] });
  const declarer: ShipCaller = { kind: 'agent', shipId: declarerShip.shipId, fleetId, scopes: ['labels:define', 'labels:assign', 'fleet:commission'] };
  const installation: InstallationCaller = { kind: 'installation', fleetId, scopes: ['labels:define'] };
  const team = unwrap(await core.useCases.defineLabel(declarer, { key: 'team', values: ['red', 'blue'] }));
  const tier = unwrap(await core.useCases.defineLabel(installation, { key: 'tier', values: ['gold', 'silver'] }));
  const valueOf = (label: { values: readonly { id: LabelValueId; value: string }[] }, name: string): LabelValueId => {
    const found = label.values.find((value) => value.value === name);
    if (found === undefined) {
      throw new Error(`The fixture label has no value ${name}`);
    }
    return found.id;
  };
  const [red, blue, gold, silver] = [valueOf(team, 'red'), valueOf(team, 'blue'), valueOf(tier, 'gold'), valueOf(tier, 'silver')];
  const teamId: LabelId = team.labelId;
  const ownRules: NetworkRule[] = [
    { verb: 'send', from: [], to: [{ labelId: teamId, value: '*' }] },
    { verb: 'read', from: [{ owner: '#' }], to: [{ owner: '#' }] },
    { verb: 'send', from: [{ labelId: teamId, value: '#' }], to: [{ labelId: teamId, value: '#' }, gold] },
    { verb: 'read', from: [gold], to: [{ owner: '*' }] },
  ];
  await fleet.setRules(ownRules);
  unwrap(await core.useCases.declareNetworkRules(declarer, { rules: [
    { verb: 'send', from: [], to: [red] },
    { verb: 'read', from: [blue, { labelId: teamId, value: '#' }], to: [{ labelId: teamId, value: '#' }] },
  ] }));
  unwrap(await core.useCases.declareNetworkRules(installation, { rules: [{ verb: 'read', from: [], to: [gold] }] }));
  const ship = async (name: string, change: { valueIds?: readonly LabelValueId[]; owner?: ShipId } = {}): Promise<ShipId> => {
    const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'builder' }));
    for (const valueId of change.valueIds ?? []) {
      unwrap(await core.useCases.assignLabel(argo, { shipId, valueId }));
    }
    if (change.owner !== undefined) {
      unwrap(await core.useCases.setOwner(argo, { shipId, ownerShipId: change.owner }));
    }
    return shipId;
  };
  const first = await ship('first');
  unwrap(await core.useCases.assignLabel(argo, { shipId: first, valueId: red }));
  unwrap(await core.useCases.assignLabel(argo, { shipId: first, valueId: gold }));
  const second = await ship('second');
  unwrap(await core.useCases.assignLabel(argo, { shipId: second, valueId: blue }));
  unwrap(await core.useCases.setOwner(argo, { shipId: second, ownerShipId: fleet.person.shipId }));
  unwrap(await core.useCases.setOwner(argo, { shipId: first, ownerShipId: argo.shipId }));
  return { ...fleet, declarer, declarerShipId: declarerShip.shipId, installation, ship, first, second, teamId, tierId: tier.labelId, red, blue, gold, silver, ownRules };
}

describe('rule matches kept by every writer', () => {
  it('stay a fresh computation after commissioning a ship with label values and a person ship', async () => {
    // Given a fleet whose rules hold for carried values and owners.
    const fleet = await aMatchedFleet();

    // When the declarer commissions a ship carrying its value, and a person ship is commissioned, owning itself.
    unwrap(await core.useCases.commissionShip(fleet.declarer, { idempotencyKey: newKey(), name: 'commissioned', type: 'builder', valueIds: [fleet.red, fleet.blue] }));
    await expectRuleMatchesKept(fleet.fleetId);
    await fleet.commission({ name: 'second-person', kind: 'person' });

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(fleet.fleetId);
    expect((await storedRuleMatchesOf(fleet.fleetId)).length).toBeGreaterThan(0);
  });

  it('stay a fresh computation after assigning and unassigning a label value', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet();

    // When a value is assigned, then another taken off.
    unwrap(await core.useCases.assignLabel(fleet.argo, { shipId: fleet.second, valueId: fleet.gold }));
    await expectRuleMatchesKept(fleet.fleetId);
    unwrap(await core.useCases.unassignLabel(fleet.argo, { shipId: fleet.first, valueId: fleet.red }));

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(fleet.fleetId);
  });

  it('stay a fresh computation after setting an owner', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet();

    // When a ship gets another owner.
    unwrap(await core.useCases.setOwner(fleet.argo, { shipId: fleet.first, ownerShipId: fleet.person.shipId }));

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(fleet.fleetId);
  });

  it('stay a fresh computation after a ship and the installation declare and withdraw rules', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet();

    // When the ship replaces its declaration, the installation its own, then the ship withdraws.
    unwrap(await core.useCases.declareNetworkRules(fleet.declarer, { rules: [{ verb: 'read', from: [], to: [fleet.blue] }, { verb: 'send', from: [], to: [] }] }));
    await expectRuleMatchesKept(fleet.fleetId);
    unwrap(await core.useCases.declareNetworkRules(fleet.installation, { rules: [{ verb: 'send', from: [], to: [fleet.silver] }] }));
    await expectRuleMatchesKept(fleet.fleetId);
    unwrap(await core.useCases.declareNetworkRules(fleet.declarer, { rules: [] }));

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(fleet.fleetId);
  });

  it('stay a fresh computation after applying other own rules, then none', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet();

    // When the fleet applies other rules of its own, then none (open).
    await fleet.setRules([{ verb: 'read', from: [], to: [fleet.silver] }, ...fleet.ownRules.slice(1)]);
    await expectRuleMatchesKept(fleet.fleetId);
    await fleet.setRules(null);

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(fleet.fleetId);
  });

  it('stay a fresh computation after retiring a carrier, a person ship owning a ship, and a declarer whose labels others carry', async () => {
    // Given a fleet with matches, the person ship owning a carrier.
    const fleet = await aMatchedFleet();
    const owned = await fleet.ship('owned', { valueIds: [fleet.blue], owner: fleet.person.shipId });

    // When a carrier retires, then the person ship, so its ship falls to argo, then the declarer.
    unwrap(await core.useCases.retireShip(fleet.argo, { shipId: fleet.first }));
    await expectRuleMatchesKept(fleet.fleetId);
    unwrap(await core.useCases.retireShip(fleet.argo, { shipId: fleet.person.shipId }));
    await expectRuleMatchesKept(fleet.fleetId);
    expect(await core.prisma.ship.findUniqueOrThrow({ where: { id: owned }, select: { ownerShipId: true } })).toEqual({ ownerShipId: fleet.argo.shipId });
    unwrap(await core.useCases.retireShip(fleet.argo, { shipId: fleet.declarerShipId }));

    // Then the stored matches are the authoritative tables' own.
    await expectRuleMatchesKept(fleet.fleetId);
  });

  it('stay a fresh computation when a change of carried label values is refused', async () => {
    // Given a fleet whose ships carry both team values.
    const fleet = await aMatchedFleet();

    // When the declarer tries to drop a carried value.
    const refused = await core.useCases.changeLabelValues(fleet.declarer, { labelId: fleet.teamId, values: ['red'] });

    // Then nothing changed, the matches included.
    expect(refused.isOk).toBe(false);
    await expectRuleMatchesKept(fleet.fleetId);
  });

  it('go with the fleet when it is deleted', async () => {
    // Given a fleet with matches.
    const fleet = await aMatchedFleet();
    expect((await storedRuleMatchesOf(fleet.fleetId)).length).toBeGreaterThan(0);

    // When the fleet is deleted.
    unwrap(await core.useCases.deleteFleet({ requestId: newKey(), fleetId: fleet.fleetId }));

    // Then none of its matches remain.
    expect(await storedRuleMatchesOf(fleet.fleetId)).toEqual([]);
  });
});
