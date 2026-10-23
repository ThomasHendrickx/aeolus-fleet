import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { argoAboard, crewAboard, historyUseCases, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew } from './caller.js';

let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let history: ReturnType<typeof historyUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Crew;
let captain: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T14:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  const registry = registryUseCases(core);
  captain = crewAboard(core, { fleetId, shipId: unwrap(await registry.commissionShip(operatorCaller(fleet), { idempotencyKey: newKey(), name: 'release-captain', type: 'release' })).shipId });
  argo = await argoAboard(core);
  messaging = messagingUseCases(core);
  history = historyUseCases(core);
});

async function send(selector: { kind: 'ship'; shipId: ShipId }, payload: string): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  core.clock.advance(60_000);
  const { messageId } = unwrap(await messaging.sendMessage(captain, { ...modelOf(captain), selector, payload, idempotencyKey: newKey() }));
  const delivery = core.state.deliveries.find((held) => held.messageId === messageId);
  return { messageId, deliveryId: delivery?.id ?? core.ids('delivery') };
}

describe('reading one message to argo by its delivery', () => {
  it('answers it as the inbox lists it, whatever its filter', async () => {
    const asked = await send({ kind: 'ship', shipId: argoId }, 'Promote 2.14?');
    unwrap(await messaging.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'go' }));
    await send({ kind: 'ship', shipId: argoId }, 'Deployed.');
    const [listed] = (await history.readInbox(argo, { filter: 'done' })).items;

    await expect(history.readInboxMessage(argo, { deliveryId: asked.deliveryId })).resolves.toEqual({ isOk: true, value: listed });
  });

  it('refuses a delivery that is not in argo\'s inbox: to another ship, or none at all', async () => {
    const elsewhere = await send({ kind: 'ship', shipId: captain.shipId }, 'a note to itself');

    for (const deliveryId of [elsewhere.deliveryId, core.ids('delivery')]) {
      await expect(history.readInboxMessage(argo, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { code: 'DELIVERY_NOT_FOUND' } });
    }
  });
});

describe('a viewer reading one message to argo', () => {
  it('reads it while viewer reading is on, and is refused once argo turns it off', async () => {
    const fleet = await readReachScenario();
    await fleet.readRulesApply();
    const asked = await fleet.send(fleet.far, { kind: 'ship', shipId: fleet.argo.shipId });
    const [listed] = (await fleet.history.readInbox(fleet.viewer, { filter: 'all' })).items;
    const deliveryId = listed?.deliveryId ?? fleet.core.ids('delivery');

    await expect(fleet.history.readInboxMessage(fleet.viewer, { deliveryId })).resolves.toMatchObject({ isOk: true, value: { message: { id: asked } } });
    unwrap(await fleet.registry.setBuiltInRule(fleet.argo, { rule: 'viewerRead', isOn: false }));
    await expect(fleet.history.readInboxMessage(fleet.viewer, { deliveryId })).resolves.toMatchObject({ isOk: false, error: { code: 'DELIVERY_NOT_FOUND' } });
  });
});
