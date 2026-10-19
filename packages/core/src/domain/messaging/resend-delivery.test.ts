import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
  modelOf,
  SESSION_MODEL,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller, Crew } from '../shared/caller.js';
import type { Selector } from '../shared/selector.js';
import { UNDELIVERABLE_AT_ATTEMPT } from './delivery.js';
import { newKey } from '../../testing/keys.js';
import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let scout: Crew;
let planner: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'tester' })));
  const { shipId: plannerId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'planner', type: 'planner' }));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  planner = crewAboard(core, { fleetId, shipId: plannerId });
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
});

/** A message from planner that the scout's crew received five times without acknowledging it: undeliverable. */
async function undeliverable(
  sent: { selector?: Selector; inReplyTo?: MessageId } = {},
): Promise<{ deliveryId: DeliveryId; messageId: MessageId }> {
  const { messageId } = unwrap(
    await useCases.sendMessage(planner, { ...modelOf(planner),
      selector: sent.selector ?? { kind: 'ship', shipId: scoutId },
      payload: '{"run":"e2e","ref":"pr-320"}',
      contentType: 'application/json',
      idempotencyKey: `run-${core.ids('message')}`,
      inReplyTo: sent.inReplyTo,
    }),
  );
  const deliveryId = deliveryIdOf(core, messageId);
  for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
    unwrap(await useCases.receiveDeliveries(scout, {}));
  }
  expect(stored(deliveryId)?.state).toBe('undeliverable');
  core.state.events.length = 0;
  core.state.notices.length = 0;
  core.clock.advance(60_000);
  return { deliveryId, messageId };
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

function message(messageId: MessageId) {
  return core.state.messages.find((held) => held.id === messageId);
}

function deliveryOf(messageId: MessageId) {
  return core.state.deliveries.find((held) => held.messageId === messageId);
}

describe('resending an undeliverable delivery', () => {
  it('sends a new message with the same payload and content type, from the original sender, naming the original', async () => {
    const original = await undeliverable();

    const { messageId } = unwrap(await useCases.resendDelivery(argo, { deliveryId: original.deliveryId }));
    expect(messageId).not.toBe(original.messageId);
    expect(message(messageId)).toMatchObject({
      senderShipId: planner.shipId,
      selector: { kind: 'ship', shipId: scoutId },
      payload: '{"run":"e2e","ref":"pr-320"}',
      contentType: 'application/json',
      inReplyToMessageId: null,
      resendOfMessageId: original.messageId,
      createdAt: core.clock.now(),
    });
  });

  it('gives the new message a pending delivery to the same ship, with no claims yet', async () => {
    const original = await undeliverable();

    const { messageId } = unwrap(await useCases.resendDelivery(argo, { deliveryId: original.deliveryId }));
    expect(deliveryOf(messageId)).toMatchObject({
      recipient: { kind: 'ship', shipId: scoutId },
      state: 'pending',
      claimedByShipId: null,
      claimedByLeaseId: null,
      attempts: 0,
    });
  });

  it('dismisses the original delivery, so it leaves Needs attention', async () => {
    const original = await undeliverable();

    unwrap(await useCases.resendDelivery(argo, { deliveryId: original.deliveryId }));
    expect(stored(original.deliveryId)).toMatchObject({ state: 'dismissed', attempts: UNDELIVERABLE_AT_ATTEMPT });
  });

  it('writes MessageAccepted naming the original and DeliveryDismissed, both caused by the operator', async () => {
    const original = await undeliverable();

    const { messageId } = unwrap(await useCases.resendDelivery(argo, { deliveryId: original.deliveryId }));
    const byArgo = { kind: 'ship', shipId: argo.shipId };
    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'MessageAccepted',
        actor: byArgo,
        shipId: scoutId,
        messageId,
        deliveryId: deliveryOf(messageId)?.id,
        details: { selector: 'ship', recipientType: null, model: SESSION_MODEL, resendOf: original.messageId },
      }),
      expect.objectContaining({
        type: 'DeliveryDismissed',
        actor: byArgo,
        shipId: scoutId,
        messageId: original.messageId,
        deliveryId: original.deliveryId,
      }),
    ]);
  });

  it('wakes the receivers of the new delivery', async () => {
    const original = await undeliverable();

    const { messageId } = unwrap(await useCases.resendDelivery(argo, { deliveryId: original.deliveryId }));
    expect(core.state.notices).toEqual([
      { fleetId, deliveryId: deliveryOf(messageId)?.id, recipient: { kind: 'ship', shipId: scoutId } },
    ]);
  });

  it('sends a delivery to a type to the type again', async () => {
    const original = await undeliverable({ selector: { kind: 'type', type: 'tester' } });

    const { messageId } = unwrap(await useCases.resendDelivery(argo, { deliveryId: original.deliveryId }));
    expect(deliveryOf(messageId)).toMatchObject({ recipient: { kind: 'type', type: 'tester' }, state: 'pending' });
  });

  it('keeps the message the original replied to', async () => {
    const { messageId: question } = unwrap(
      await useCases.sendMessage(scout, { ...modelOf(scout),
        selector: { kind: 'ship', shipId: planner.shipId },
        payload: 'Which ref?',
        idempotencyKey: 'which-ref',
      }),
    );
    const original = await undeliverable({ inReplyTo: question });

    const { messageId } = unwrap(await useCases.resendDelivery(argo, { deliveryId: original.deliveryId }));
    expect(message(messageId)?.inReplyToMessageId).toBe(question);
  });

  it('answers a second resend of the same delivery with the same new message, and stores nothing more', async () => {
    const original = await undeliverable();
    const first = unwrap(await useCases.resendDelivery(argo, { deliveryId: original.deliveryId }));
    const messages = core.state.messages.length;
    core.state.events.length = 0;

    await expect(useCases.resendDelivery(argo, { deliveryId: original.deliveryId })).resolves.toEqual({
      isOk: true,
      value: first,
    });
    expect(core.state.messages).toHaveLength(messages);
    expect(core.state.events).toEqual([]);
  });

  it('refuses when the ship it was for is retired, and leaves the original undeliverable', async () => {
    const original = await undeliverable();
    unwrap(await registry.retireShip(argo, { shipId: scoutId }));
    const messages = core.state.messages.length;

    await expect(useCases.resendDelivery(argo, { deliveryId: original.deliveryId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'UNRESOLVABLE_SELECTOR' },
    });
    expect(stored(original.deliveryId)?.state).toBe('undeliverable');
    expect(core.state.messages).toHaveLength(messages);
  });

  it.each(['pending', 'handed', 'acknowledged', 'dismissed', 'abandoned'] as const)(
    'refuses a delivery that is %s: only an undeliverable one is resent',
    async (state) => {
      const original = await undeliverable();
      const held = stored(original.deliveryId);
      if (held) {
        held.state = state;
      }

      await expect(useCases.resendDelivery(argo, { deliveryId: original.deliveryId })).resolves.toMatchObject({
        isOk: false,
        error: { kind: 'DELIVERY_NOT_UNDELIVERABLE' },
      });
      expect(core.state.events).toEqual([]);
    },
  );

  it('refuses an undeliverable ping, and leaves it undeliverable: a fresh ping goes through Ping, pings never stack', async () => {
    const { messageId } = unwrap(await useCases.pingShip(argo, { shipId: scoutId }));
    for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
      unwrap(await useCases.receiveDeliveries(scout, {}));
    }
    const before = structuredClone(core.state);

    await expect(useCases.resendDelivery(argo, { deliveryId: deliveryIdOf(core, messageId) })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'PING_NOT_RESENT', message: 'A ping is not resent: dismiss it, and ping the ship again' },
    });
    expect(core.state).toEqual(before);
  });

  it('resends a delivery not handled as an undeliverable one: a new pending message, the original dismissed', async () => {
    const { messageId: original } = unwrap(
      await useCases.sendMessage(planner, {
        ...modelOf(planner),
        selector: { kind: 'ship', shipId: scoutId },
        payload: '{"run":"e2e","ref":"pr-320"}',
        contentType: 'application/json',
        idempotencyKey: `run-${core.ids('message')}`,
      }),
    );
    const deliveryId = deliveryIdOf(core, original);
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));
    unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 1 }));
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
    unwrap(await useCases.handOverDelivery(scout, { deliveryId, handOverNumber: 2, isOnceMore: true }));
    unwrap(await useCases.reportNotHandled(scout, { deliveryId }));

    const { messageId } = unwrap(await useCases.resendDelivery(argo, { deliveryId }));

    expect(message(messageId)).toMatchObject({ senderShipId: planner.shipId, resendOfMessageId: original });
    expect(deliveryOf(messageId)).toMatchObject({ recipient: { kind: 'ship', shipId: scoutId }, state: 'pending', attempts: 0 });
    expect(stored(deliveryId)).toMatchObject({ state: 'dismissed' });
  });

  it('refuses a delivery the fleet does not have', async () => {
    await expect(useCases.resendDelivery(argo, { deliveryId: core.ids('delivery') })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'DELIVERY_NOT_FOUND' },
    });
  });
});

/** A ship argo commissioned with the scopes, crewed, as the scenario's ships are. */
async function crewedIn(fleet: ReadReachScenario, ship: Parameters<typeof shipWithScopes>[1]): Promise<Crew> {
  const caller = await shipWithScopes({ registry: fleet.registry, argo: fleet.argo }, ship);
  return { ...crewAboard(fleet.core, caller), scopes: caller.scopes };
}

describe('resending within read reach (decision 0046)', () => {
  let fleet: ReadReachScenario;
  let resender: Crew;

  beforeEach(async () => {
    fleet = await readReachScenario();
    resender = await crewedIn(fleet, { name: 'resender', type: 'resender', scopes: ['messages:resend'] });
    await fleet.carry(resender, 'a');
  });

  it('resends a stuck delivery of a message it reads, through its recipient', async () => {
    const deliveryId = await fleet.undeliverable(fleet.far, fleet.near);
    await fleet.readRulesApply();

    await expect(fleet.messaging.resendDelivery(resender, { deliveryId })).resolves.toMatchObject({ isOk: true });
  });

  it('answers a stuck delivery of a message it does not read as none, and sends nothing', async () => {
    const distant = await crewedIn(fleet, { name: 'distant', type: 'keeper', scopes: [] });
    const deliveryId = await fleet.undeliverable(fleet.far, distant);
    await fleet.readRulesApply();
    const messages = fleet.core.state.messages.length;

    await expect(fleet.messaging.resendDelivery(resender, { deliveryId })).resolves.toEqual({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND', message: `Delivery ${deliveryId} does not exist` } });
    expect(fleet.core.state.deliveries.find((held) => held.id === deliveryId)?.state).toBe('undeliverable');
    expect(fleet.core.state.messages).toHaveLength(messages);
  });
});
