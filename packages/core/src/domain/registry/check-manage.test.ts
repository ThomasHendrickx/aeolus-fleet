import { accountIdSchema } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, everyShipMay } from '../../../test/support/core-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { refusedShip } from '../../../test/support/refused-sender.js';
import type { AccountCaller, ShipCaller } from '../shared/caller.js';

/**
 * Checking manage reach (design gateway-scopes 4.2): any actor asks, with no
 * scope, whether it manages a ship, as every fleet:manage call checks it.
 * near carries team a, far team b; the rules let team a manage team a.
 */
let fleet: ReadReachScenario;
let near: ShipCaller;

beforeEach(async () => {
  fleet = await readReachScenario();
  near = { ...fleet.near, scopes: [] };
  await applyNetworkRules(fleet.registry, { by: fleet.networking, rules: [{ verb: 'manage', from: [fleet.team('a')], to: [fleet.team('a')] }, everyShipMay('send'), everyShipMay('read')] });
  fleet.core.state.reachRefusals.length = 0;
});

describe('checking manage reach on a ship', () => {
  it('answers OK for a ship within manage reach, recording nothing', async () => {
    await expect(fleet.registry.checkManage(near, { shipId: fleet.reader.shipId })).resolves.toEqual({ isOk: true, value: undefined });

    expect(fleet.core.state.reachRefusals).toEqual([]);
  });

  it('checks any actor: an account with no scope and no group is refused, argo reaches every ship', async () => {
    const account: AccountCaller = { kind: 'account', accountId: accountIdSchema.parse('acc-mathilde'), fleetId: fleet.fleetId, scopes: [], groupValues: [], personShipId: null, throughShipId: null };

    await expect(fleet.registry.checkManage(account, { shipId: fleet.far.shipId })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE' } });
    await expect(fleet.registry.checkManage(fleet.argo, { shipId: fleet.far.shipId })).resolves.toEqual({ isOk: true, value: undefined });
  });

  it('refuses a ship outside manage reach as every manage call does, naming no rule', async () => {
    await expect(fleet.registry.checkManage(near, { shipId: fleet.far.shipId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this manage' },
    });
  });

  it('records the refusal with the verb manage, the ships and the settings version', async () => {
    await fleet.registry.checkManage(near, { shipId: fleet.far.shipId });

    const settingsVersion = fleet.core.state.networkSettings.find((settings) => settings.fleetId === fleet.fleetId)?.version;
    expect(
      fleet.core.state.reachRefusals.map(({ verb, sender, recipient, settingsVersion: version }) => ({ verb, sender: refusedShip(sender).id, recipient: recipient.kind === 'ship' ? recipient.ship.id : null, version })),
    ).toEqual([{ verb: 'manage', sender: near.shipId, recipient: fleet.far.shipId, version: settingsVersion }]);
  });

  it('refuses a ship that does not exist, recording nothing', async () => {
    await expect(fleet.registry.checkManage(near, { shipId: fleet.core.ids('ship') })).resolves.toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });

    expect(fleet.core.state.reachRefusals).toEqual([]);
  });
});
