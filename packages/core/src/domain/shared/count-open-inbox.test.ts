import { accountIdSchema, type LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, deliveryIdOf, everyShipMay } from '../../../test/support/core-fixtures.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { unwrap } from '../../testing/result.js';
import type { AccountCaller } from './caller.js';

/**
 * How many messages wait open in argo's inbox (docs/blueprint.md, "Inbox"),
 * for the navigation and the Open segment: counted in one query, by the
 * caller's read reach. near carries group a, far group b.
 */
let fleet: ReadReachScenario;

function group(value: 'a' | 'b'): LabelValueId {
  return valueIdOf(fleet.core, { key: 'group', value });
}

beforeEach(async () => {
  fleet = await readReachScenario();
  unwrap(await fleet.registry.defineLabel(fleet.argo, { key: 'group', values: ['a', 'b'] }));
  unwrap(await fleet.registry.assignLabel(fleet.argo, { shipId: fleet.near.shipId, valueId: group('a') }));
  unwrap(await fleet.registry.assignLabel(fleet.argo, { shipId: fleet.far.shipId, valueId: group('b') }));
});

describe("counting argo's open messages", () => {
  it('counts the open messages to argo, not those done, those argo sent or those to other ships', async () => {
    await fleet.send(fleet.near, { kind: 'ship', shipId: fleet.argo.shipId });
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });
    const done = await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });
    unwrap(await fleet.messaging.markDone(fleet.argo, { deliveryId: deliveryIdOf(fleet.core, done) }));
    await fleet.send(fleet.argo, { kind: 'ship', shipId: fleet.near.shipId });
    await fleet.send(fleet.near, { kind: 'ship', shipId: fleet.far.shipId });

    await expect(fleet.history.countOpenInbox(fleet.argo)).resolves.toEqual({ open: 2 });
  });

  it("counts none of another fleet's inbox", async () => {
    await fleet.send(fleet.near, { kind: 'ship', shipId: fleet.argo.shipId });

    await expect(fleet.history.countOpenInbox({ ...fleet.argo, fleetId: fleet.core.ids('fleet') })).resolves.toEqual({ open: 0 });
  });

  it('counts for a viewer the open messages to argo while viewer reading is on, and none once argo turns it off', async () => {
    await fleet.readRulesApply();
    await fleet.send(fleet.near, { kind: 'ship', shipId: fleet.argo.shipId });
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });
    const whileOn = await fleet.history.countOpenInbox(fleet.viewer);
    unwrap(await fleet.registry.setBuiltInRule(fleet.argo, { rule: 'viewerRead', isOn: false }));

    expect([whileOn, await fleet.history.countOpenInbox(fleet.viewer)]).toEqual([{ open: 2 }, { open: 0 }]);
  });

  it('counts for an account only the open messages to argo whose sender its read reach reads', async () => {
    await applyNetworkRules(fleet.registry, {
      by: fleet.networking,
      rules: [{ verb: 'read', from: [group('a')], to: [group('a')] }, everyShipMay('send'), everyShipMay('manage')],
    });
    const mathilde: AccountCaller = {
      kind: 'account',
      accountId: accountIdSchema.parse('acc-mathilde'),
      fleetId: fleet.fleetId,
      scopes: ['fleet:read'],
      groupValues: ['a'],
      personShipId: null,
      throughShipId: null,
    };
    await fleet.send(fleet.near, { kind: 'ship', shipId: fleet.argo.shipId });
    await fleet.send(fleet.near, { kind: 'ship', shipId: fleet.argo.shipId });
    await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });

    await expect(fleet.history.countOpenInbox(mathilde)).resolves.toEqual({ open: 2 });
  });
});
