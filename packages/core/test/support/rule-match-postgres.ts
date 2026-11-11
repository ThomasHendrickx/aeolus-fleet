/**
 * Rule-match fixtures over a real database (#1741): a closed fleet whose own,
 * installation and ship-declared rules hold for carried values and owners,
 * and the consistency guard of rule-matches.md Q4: the stored matches equal a
 * fresh computation from the authoritative tables.
 */
import { idSchema, type FleetId, type LabelId, type LabelValueId, type NetworkRule, type ShipId } from '@aeolus-fleet/common';
import { expect } from 'vitest';
import { z } from 'zod';

import { createPrismaDeclaredNetworkRulesRepository, createPrismaNetworkSettingsRepository } from '../../src/adapters/prisma/network.js';
import { createPrismaRuleMatchRepository, sourceText } from '../../src/adapters/prisma/rule-matches.js';
import { ruleMatchesOf, ruleSourcesOf, type RuleMatch } from '../../src/domain/registry/rule-matches.js';
import type { InstallationCaller, ShipCaller } from '../../src/domain/shared/caller.js';
import { newKey } from '../../src/testing/keys.js';
import { unwrap } from '../../src/testing/result.js';
import { aPersonReadFleet } from './person-read-postgres.js';
import type { PostgresCore } from './postgres-core.js';

const shipRowSchema = z.object({ id: idSchema('ship'), owner: idSchema('ship').nullable() });
const carriedRowSchema = z.object({ shipId: idSchema('ship'), labelId: idSchema('label'), valueId: idSchema('labelValue'), declarer: idSchema('ship').nullable() });

const order = (matches: readonly RuleMatch[]) =>
  matches.map((match) => ({ ...match, source: sourceText(match.source) })).sort((one, other) => `${one.shipId}|${one.verb}|${one.source}`.localeCompare(`${other.shipId}|${other.verb}|${other.source}`));

export async function freshRuleMatchesOf(core: PostgresCore, fleetId: FleetId): Promise<RuleMatch[]> {
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

export async function storedRuleMatchesOf(core: PostgresCore, fleetId: FleetId): Promise<RuleMatch[]> {
  return createPrismaRuleMatchRepository(core.prisma).list(fleetId);
}

export async function expectRuleMatchesKept(core: PostgresCore, fleetId: FleetId): Promise<void> {
  expect(order(await storedRuleMatchesOf(core, fleetId))).toEqual(order(await freshRuleMatchesOf(core, fleetId)));
}

/** A closed fleet with own, installation and ship-declared rules, labels of each owner carried, and a person ship owning a ship. */
export async function aMatchedFleet(core: PostgresCore) {
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

