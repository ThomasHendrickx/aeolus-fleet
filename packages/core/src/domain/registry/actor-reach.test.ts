import { accountIdSchema, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, everyShipMay } from '../../../test/support/core-fixtures.js';
import { labelIdOf, valueIdOf } from '../../../test/support/label-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { unwrap } from '../../testing/result.js';
import type { AccountCaller, InstallationCaller } from '../shared/caller.js';

/**
 * Reach for every actor (decisions 0034, 0057): an account reaches by the
 * values of the label `group` its token carries and as the owner of what its
 * person ship owns; the installation manages person ships and the ships they
 * own by a built-in rule that is never off. The fleet defines `group`
 * (engineering, finance): near carries group engineering, far group
 * finance. The rules let group engineering manage and read group
 * engineering, with open off for manage and read.
 */
let fleet: ReadReachScenario;
let mathilde: AccountCaller;
let installation: InstallationCaller;

const NOT_REACHABLE = { isOk: false, error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this manage' } };
const MATHILDE = accountIdSchema.parse('acc-mathilde');

function group(value: 'engineering' | 'finance') {
  return valueIdOf(fleet.core, { key: 'group', value });
}

async function aPersonShip(name: string): Promise<ShipId> {
  return unwrap(await fleet.registry.commissionShip(fleet.argo, { idempotencyKey: `commission-${name}`, name, type: 'person', kind: 'person' })).shipId;
}

beforeEach(async () => {
  fleet = await readReachScenario();
  unwrap(await fleet.registry.defineLabel(fleet.argo, { key: 'group', values: ['engineering', 'finance'] }));
  unwrap(await fleet.registry.assignLabel(fleet.argo, { shipId: fleet.near.shipId, valueId: group('engineering') }));
  unwrap(await fleet.registry.assignLabel(fleet.argo, { shipId: fleet.far.shipId, valueId: group('finance') }));
  await applyNetworkRules(fleet.registry, {
    by: fleet.networking,
    rules: [
      { verb: 'manage', from: [group('engineering')], to: [group('engineering')] },
      { verb: 'read', from: [group('engineering')], to: [group('engineering')] },
      everyShipMay('send'),
    ],
  });
  fleet.core.state.reachRefusals.length = 0;
  mathilde = { kind: 'account', accountId: MATHILDE, fleetId: fleet.fleetId, scopes: ['fleet:read', 'fleet:manage'], groupValues: ['engineering'], personShipId: null, throughShipId: null };
  installation = { kind: 'installation', fleetId: fleet.fleetId, scopes: ['fleet:person', 'fleet:manage', 'labels:define', 'labels:assign', 'labels:any'] };
});

describe("an account's manage reach", () => {
  it('manages a ship a rule on its group values lets it reach', async () => {
    await expect(fleet.registry.renameShip(mathilde, { shipId: fleet.near.shipId, name: 'nearer' })).resolves.toMatchObject({ isOk: true });
  });

  it('is refused a ship no rule lets it reach, as a ship is', async () => {
    await expect(fleet.registry.renameShip(mathilde, { shipId: fleet.far.shipId, name: 'renamed' })).resolves.toEqual(NOT_REACHABLE);
  });

  it('records the refusal naming the account by its id, with the group values it carried, and no email', async () => {
    await fleet.registry.releaseShip(mathilde, { shipId: fleet.far.shipId });

    expect(fleet.core.state.reachRefusals.map(({ verb, sender }) => ({ verb, sender }))).toEqual([
      {
        verb: 'manage',
        sender: { kind: 'account', accountId: MATHILDE, labels: [{ labelId: labelIdOf(fleet.core, 'group'), key: 'group', valueId: group('engineering'), value: 'engineering' }], personShip: null },
      },
    ]);
  });

  it('matches nothing by a group value the fleet does not define', async () => {
    const stranger: AccountCaller = { ...mathilde, groupValues: ['marketing'] };

    await expect(fleet.registry.renameShip(stranger, { shipId: fleet.near.shipId, name: 'renamed' })).resolves.toEqual(NOT_REACHABLE);
  });

  it('matches a rule of the same group value on both sides', async () => {
    const sameGroup = { labelId: labelIdOf(fleet.core, 'group'), value: '#' } as const;
    await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: [{ verb: 'manage', from: [sameGroup], to: [sameGroup] }, everyShipMay('send')] });

    await expect(fleet.registry.renameShip(mathilde, { shipId: fleet.near.shipId, name: 'nearer' })).resolves.toMatchObject({ isOk: true });
    await expect(fleet.registry.renameShip(mathilde, { shipId: fleet.far.shipId, name: 'renamed' })).resolves.toEqual(NOT_REACHABLE);
  });

  it('manages the ships its person ship owns by the owner rule, with no manage rule (decision 0057)', async () => {
    const personShipId = await aPersonShip('thomas');
    unwrap(await fleet.registry.setOwner(fleet.argo, { shipId: fleet.far.shipId, ownerShipId: personShipId }));
    const thomas: AccountCaller = { ...mathilde, accountId: accountIdSchema.parse('acc-thomas'), groupValues: [], personShipId };

    await expect(fleet.registry.renameShip(thomas, { shipId: fleet.far.shipId, name: 'kept' })).resolves.toMatchObject({ isOk: true });
  });

  it('reaches no owned ship without a person ship', async () => {
    const personShipId = await aPersonShip('thomas');
    unwrap(await fleet.registry.setOwner(fleet.argo, { shipId: fleet.far.shipId, ownerShipId: personShipId }));

    await expect(fleet.registry.renameShip({ ...mathilde, groupValues: [] }, { shipId: fleet.far.shipId, name: 'kept' })).resolves.toEqual(NOT_REACHABLE);
  });

  it('manages every ship while no rules are applied, open on, as a ship does', async () => {
    await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: null });

    await expect(fleet.registry.renameShip(mathilde, { shipId: fleet.far.shipId, name: 'renamed' })).resolves.toMatchObject({ isOk: true });
  });

  it("names the account in the change's event, by its id only, with the ship that presented its token", async () => {
    const throughShipId = fleet.reader.shipId;

    unwrap(await fleet.registry.renameShip({ ...mathilde, throughShipId }, { shipId: fleet.near.shipId, name: 'nearer' }));

    expect(fleet.core.state.events.filter((event) => event.type === 'ShipRenamed').map((event) => event.actor)).toEqual([{ kind: 'account', accountId: MATHILDE, throughShipId }]);
  });
});

describe("an account's read reach", () => {
  it('reads in full only the ships a read rule on its group values lets it read', async () => {
    const ships = (await fleet.registry.listFleet(mathilde, {})).ships;

    expect(ships.find((ship) => ship.id === fleet.near.shipId)).toHaveProperty('scopes');
    expect(ships.find((ship) => ship.id === fleet.far.shipId)).not.toHaveProperty('scopes');
  });
});

describe("the installation's manage reach", () => {
  it('manages a person ship by its built-in rule, with no manage rule', async () => {
    const personShipId = await aPersonShip('burak');

    await expect(fleet.registry.renameShip(installation, { shipId: personShipId, name: 'burak-left' })).resolves.toMatchObject({ isOk: true });
  });

  it('manages a ship a person ship owns by its built-in rule', async () => {
    const personShipId = await aPersonShip('burak');
    unwrap(await fleet.registry.setOwner(fleet.argo, { shipId: fleet.far.shipId, ownerShipId: personShipId }));

    await expect(fleet.registry.releaseShip(installation, { shipId: fleet.far.shipId })).resolves.toMatchObject({ isOk: true });
  });

  it('is refused a ship argo owns that no rule lets it reach, the refusal naming the installation', async () => {
    await expect(fleet.registry.renameShip(installation, { shipId: fleet.far.shipId, name: 'renamed' })).resolves.toEqual(NOT_REACHABLE);
    expect(fleet.core.state.reachRefusals.map(({ sender }) => sender)).toEqual([{ kind: 'installation' }]);
  });

  it("names the installation in the change's event", async () => {
    const personShipId = await aPersonShip('burak');

    unwrap(await fleet.registry.renameShip(installation, { shipId: personShipId, name: 'burak-left' }));

    expect(fleet.core.state.events.filter((event) => event.type === 'ShipRenamed').map((event) => event.actor)).toEqual([{ kind: 'installation' }]);
  });

  it('lists its rule among the built-in rules, never off', async () => {
    expect(unwrap(await fleet.registry.readBuiltInRules(fleet.networking))).toContainEqual({ rule: 'installation', isOn: true });
  });

  it('refuses turning its rule off', async () => {
    await expect(fleet.registry.setBuiltInRule(fleet.networking, { rule: 'installation', isOn: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'BUILT_IN_RULE_FIXED' } });
  });
});
