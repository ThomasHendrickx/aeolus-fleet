import { accountIdSchema, type LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, everyShipMay } from '../../../test/support/core-fixtures.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { unwrap } from '../../testing/result.js';
import type { AccountCaller } from '../shared/caller.js';

/**
 * The console's message actions for an account signed in as itself
 * (accounts design, F1, F3): ping, dismiss and resend take the account as
 * their actor, within its reach. A ping stays argo's message (blueprint,
 * Ping); the event names the account. near carries group a, far group b;
 * the rules let group a manage and read group a.
 */
let fleet: ReadReachScenario;
let mathilde: AccountCaller;

const MATHILDE = accountIdSchema.parse('acc-mathilde');
const ACTOR = { kind: 'account', accountId: MATHILDE, throughShipId: null };
const NOT_REACHABLE = { isOk: false, error: { kind: 'NOT_REACHABLE' } };

function group(value: 'a' | 'b'): LabelValueId {
  return valueIdOf(fleet.core, { key: 'group', value });
}

beforeEach(async () => {
  fleet = await readReachScenario();
  unwrap(await fleet.registry.defineLabel(fleet.argo, { key: 'group', values: ['a', 'b'] }));
  unwrap(await fleet.registry.assignLabel(fleet.argo, { shipId: fleet.near.shipId, valueId: group('a') }));
  unwrap(await fleet.registry.assignLabel(fleet.argo, { shipId: fleet.far.shipId, valueId: group('b') }));
  await applyNetworkRules(fleet.registry, {
    by: fleet.networking,
    rules: [{ verb: 'manage', from: [group('a')], to: [group('a')] }, { verb: 'read', from: [group('a')], to: [group('a')] }, everyShipMay('send')],
  });
  mathilde = { kind: 'account', accountId: MATHILDE, fleetId: fleet.fleetId, scopes: ['fleet:read', 'fleet:manage', 'messages:resend'], groupValues: ['a'], personShipId: null, throughShipId: null };
  fleet.core.state.events.length = 0;
});

describe('an account pinging a ship', () => {
  it("sends argo's ping to a ship in its reach, the event naming the account", async () => {
    const { messageId } = unwrap(await fleet.messaging.pingShip(mathilde, { shipId: fleet.near.shipId }));

    const message = fleet.core.state.messages.find(({ id }) => id === messageId);
    expect(message?.senderShipId).toBe(fleet.argo.shipId);
    expect(fleet.core.state.events.filter(({ type }) => type === 'MessageAccepted').map(({ actor }) => actor)).toEqual([ACTOR]);
  });

  it('is refused a ship out of its reach, and sends nothing', async () => {
    const before = fleet.core.state.messages.length;

    await expect(fleet.messaging.pingShip(mathilde, { shipId: fleet.far.shipId })).resolves.toMatchObject(NOT_REACHABLE);
    expect(fleet.core.state.messages).toHaveLength(before);
  });
});

describe('an account dismissing or resending an undeliverable delivery', () => {
  it('dismisses one it reads, the event naming the account', async () => {
    const deliveryId = await fleet.undeliverable(fleet.argo, fleet.near);
    fleet.core.state.events.length = 0;

    unwrap(await fleet.messaging.dismissDelivery(mathilde, { deliveryId }));

    expect(fleet.core.state.deliveries.find(({ id }) => id === deliveryId)?.state).toBe('dismissed');
    expect(fleet.core.state.events.map(({ type, actor }) => ({ type, actor }))).toEqual([{ type: 'DeliveryDismissed', actor: ACTOR }]);
  });

  it('resends one it reads from its original sender, the events naming the account', async () => {
    const deliveryId = await fleet.undeliverable(fleet.argo, fleet.near);
    fleet.core.state.events.length = 0;

    const { messageId } = unwrap(await fleet.messaging.resendDelivery(mathilde, { deliveryId }));

    expect(fleet.core.state.messages.find(({ id }) => id === messageId)?.senderShipId).toBe(fleet.argo.shipId);
    const actors = fleet.core.state.events.map(({ actor }) => actor);
    expect(actors.length).toBeGreaterThan(0);
    expect(actors).toEqual(actors.map(() => ACTOR));
  });

  it('finds none it does not read, and leaves it undeliverable', async () => {
    const deliveryId = await fleet.undeliverable(fleet.argo, fleet.far);

    await expect(fleet.messaging.dismissDelivery(mathilde, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND' } });
    await expect(fleet.messaging.resendDelivery(mathilde, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND' } });
    expect(fleet.core.state.deliveries.find(({ id }) => id === deliveryId)?.state).toBe('undeliverable');
  });
});
