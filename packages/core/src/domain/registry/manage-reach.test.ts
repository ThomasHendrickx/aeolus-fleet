import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, crewAboard, everyShipMay } from '../../../test/support/core-fixtures.js';
import { aCrewSettings, shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { unwrap } from '../../testing/result.js';
import type { Crew } from '../shared/caller.js';
import { refusedShip } from '../../../test/support/refused-sender.js';

/**
 * Manage reach (decision 0034, 0046): every fleet:manage call is checked
 * against manage rules on its target ship. The manager carries team a; the
 * rules let team a manage team a, with open off for manage. near carries
 * team a, far team b.
 */
let fleet: ReadReachScenario;
let manager: Crew;

beforeEach(async () => {
  fleet = await readReachScenario();
  const caller = await shipWithScopes({ registry: fleet.registry, argo: fleet.argo }, { name: 'manager', type: 'manager', scopes: ['fleet:manage'] });
  manager = { ...crewAboard(fleet.core, caller), scopes: caller.scopes };
  await fleet.carry(manager, 'a');
  await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: [{ verb: 'manage', from: [fleet.team('a')], to: [fleet.team('a')] }, everyShipMay('send'), everyShipMay('read')] });
  fleet.core.state.reachRefusals.length = 0;
});

const NOT_REACHABLE = { isOk: false, error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this manage' } };

/** Each fleet:manage call on a target ship, as the manager makes it. */
const CALLS: [string, (shipId: ShipId) => Promise<unknown>][] = [
  ['rename', (shipId) => fleet.registry.renameShip(manager, { shipId, name: 'renamed' })],
  ['release', (shipId) => fleet.registry.releaseShip(manager, { shipId })],
  ['recrew', (shipId) => fleet.registry.recrewShip(manager, { shipId })],
  ['retire', (shipId) => fleet.registry.retireShip(manager, { shipId })],
  ['getStartingPrompt', (shipId) => fleet.registry.getStartingPrompt(manager, { shipId })],
  ['ping', (shipId) => fleet.messaging.pingShip(manager, { shipId })],
  ['crewRequest', (shipId) => fleet.registry.requestCrew(manager, { shipId, settings: aCrewSettings() })],
  ['removeCrewRequest', (shipId) => fleet.registry.removeCrewRequest(manager, { shipId })],
  ['clearWorktree', (shipId) => fleet.registry.requestWorktreeClear(manager, { trierarchShipId: fleet.reader.shipId, shipId, repository: 'aeolus-fleet' })],
];

describe('a fleet:manage call outside manage reach', () => {
  it.each(CALLS)('refuses %s on a ship no manage rule lets it reach, naming no rule', async (_call, call) => {
    await expect(call(fleet.far.shipId)).resolves.toEqual(NOT_REACHABLE);
  });

  it.each(CALLS)('records the refused %s with the verb manage, the ships and the settings version', async (_call, call) => {
    await call(fleet.far.shipId);

    const settingsVersion = fleet.core.state.networkSettings.find((settings) => settings.fleetId === fleet.fleetId)?.version;
    expect(
      fleet.core.state.reachRefusals.map(({ verb, sender, recipient, settingsVersion: version }) => ({ verb, sender: refusedShip(sender).id, recipient: recipient.kind === 'ship' ? recipient.ship.id : null, version })),
    ).toEqual([{ verb: 'manage', sender: manager.shipId, recipient: fleet.far.shipId, version: settingsVersion }]);
  });

  it('changes nothing it refuses: far keeps its name and stays active', async () => {
    await fleet.registry.renameShip(manager, { shipId: fleet.far.shipId, name: 'renamed' });
    await fleet.registry.retireShip(manager, { shipId: fleet.far.shipId });

    expect(fleet.core.state.ships.find((ship) => ship.id === fleet.far.shipId)).toMatchObject({ name: 'far', retiredAt: null });
  });
});

describe('a fleet:manage call within manage reach', () => {
  it('renames, pings, requests crew for and retires a ship a manage rule lets it reach', async () => {
    await expect(fleet.registry.renameShip(manager, { shipId: fleet.near.shipId, name: 'nearer' })).resolves.toMatchObject({ isOk: true });
    await expect(fleet.messaging.pingShip(manager, { shipId: fleet.near.shipId })).resolves.toMatchObject({ isOk: true });
    await expect(fleet.registry.requestCrew(manager, { shipId: fleet.near.shipId, settings: aCrewSettings() })).resolves.toMatchObject({ isOk: true });
    await expect(fleet.registry.removeCrewRequest(manager, { shipId: fleet.near.shipId })).resolves.toMatchObject({ isOk: true });
    await expect(fleet.registry.releaseShip(manager, { shipId: fleet.near.shipId })).resolves.toMatchObject({ isOk: true });
    await expect(fleet.registry.getStartingPrompt(manager, { shipId: fleet.near.shipId })).resolves.toMatchObject({ isOk: true });
    await expect(fleet.registry.retireShip(manager, { shipId: fleet.near.shipId })).resolves.toMatchObject({ isOk: true });
    expect(fleet.core.state.reachRefusals).toEqual([]);
  });

  it("manages a ship its person's ship owns by the owner rule, with no manage rule (decision 0045)", async () => {
    const person = unwrap(await fleet.registry.commissionShip(fleet.argo, { idempotencyKey: 'commission-thomas', name: 'thomas', type: 'person', kind: 'person', scopes: ['fleet:manage'] }));
    const owner: Crew = { ...crewAboard(fleet.core, { fleetId: fleet.fleetId, shipId: person.shipId }), kind: 'person', scopes: ['messages:send', 'messages:receive', 'fleet:manage'] };
    unwrap(await fleet.registry.setOwner(fleet.argo, { shipId: fleet.far.shipId, ownerShipId: person.shipId }));

    await expect(fleet.registry.renameShip(owner, { shipId: fleet.far.shipId, name: 'kept' })).resolves.toMatchObject({ isOk: true });
  });

  it('lets every ship manage within open, while no rules are applied', async () => {
    await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: null });

    await expect(fleet.registry.renameShip(manager, { shipId: fleet.far.shipId, name: 'renamed' })).resolves.toMatchObject({ isOk: true });
  });

  it('lets argo manage every ship, whatever the rules', async () => {
    await expect(fleet.registry.renameShip(fleet.argo, { shipId: fleet.far.shipId, name: 'renamed' })).resolves.toMatchObject({ isOk: true });
  });
});
