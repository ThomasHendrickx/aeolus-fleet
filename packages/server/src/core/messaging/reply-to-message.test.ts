import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  argoAboard,
  crewAboard,
  deliveryIdOf,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let operator: Caller;
let argo: Crew;
let captain: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T14:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  operator = operatorCaller(fleet);
  const { shipId } = unwrap(await registryUseCases(core).commissionShip(operator, { name: 'release-captain', type: 'release' }));
  captain = crewAboard(core, { fleetId, shipId });
  argo = await argoAboard(core);
  useCases = messagingUseCases(core);
  core.clock.advance(60_000);
});

/** A message from release-captain to argo, waiting in argo's inbox. */
async function toArgo(): Promise<{ deliveryId: DeliveryId; messageId: MessageId }> {
  const { messageId } = unwrap(
    await useCases.sendMessage(captain, {
      selector: { kind: 'ship', shipId: argoId },
      payload: 'Promote to production? Reply "go" to promote.',
      idempotencyKey: `promote-${core.ids('message')}`,
    }),
  );
  core.state.events.length = 0;
  core.state.notices.length = 0;
  core.clock.advance(60_000);
  return { deliveryId: deliveryIdOf(core, messageId), messageId };
}

function message(messageId: MessageId) {
  return core.state.messages.find((held) => held.id === messageId);
}

function stored(deliveryId: DeliveryId) {
  return core.state.deliveries.find((held) => held.id === deliveryId);
}

describe('replying to a message to argo', () => {
  it('sends the reply from argo to the sender, as plain text naming the message', async () => {
    const asked = await toArgo();

    const { messageId } = unwrap(
      await useCases.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'reply-go' }),
    );
    expect(message(messageId)).toMatchObject({
      senderShipId: argoId,
      selector: { kind: 'ship', shipId: captain.shipId },
      payload: 'go',
      contentType: 'text/plain',
      inReplyToMessageId: asked.messageId,
    });
    expect(core.state.notices).toEqual([
      expect.objectContaining({ recipient: { kind: 'ship', shipId: captain.shipId } }),
    ]);
  });

  it('marks the message done in the same step, its acknowledgement naming the reply', async () => {
    const asked = await toArgo();

    const { messageId } = unwrap(
      await useCases.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'reply-go' }),
    );
    expect(stored(asked.deliveryId)).toMatchObject({ state: 'acknowledged', claimedByLeaseId: argo.leaseId });
    expect(core.state.events.map((event) => event.type)).toEqual([
      'MessageAccepted',
      'DeliveryClaimed',
      'DeliveryAcknowledged',
    ]);
    expect(core.state.events[2]?.details).toEqual({ leaseId: argo.leaseId, reply: messageId });
  });

  it('replies to a message already done as a new message, and leaves it done', async () => {
    const asked = await toArgo();
    unwrap(await useCases.markDone(argo, { deliveryId: asked.deliveryId }));
    core.state.events.length = 0;

    unwrap(await useCases.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'and thanks', idempotencyKey: 'thanks' }));
    expect(core.state.events.map((event) => event.type)).toEqual(['MessageAccepted']);
    expect(stored(asked.deliveryId)?.state).toBe('acknowledged');
  });

  it('answers a repeat of the reply with the same message, and stores nothing more', async () => {
    const asked = await toArgo();
    const reply = { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'reply-go' };
    const first = unwrap(await useCases.replyToMessage(argo, reply));
    const messages = core.state.messages.length;
    core.state.events.length = 0;

    await expect(useCases.replyToMessage(argo, reply)).resolves.toEqual({ isOk: true, value: first });
    expect(core.state.messages).toHaveLength(messages);
    expect(core.state.events).toEqual([]);
  });

  it('refuses a payload over 64 KB, and leaves the message open', async () => {
    const asked = await toArgo();

    await expect(
      useCases.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'a'.repeat(64 * 1024 + 1), idempotencyKey: 'big' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'PAYLOAD_TOO_LARGE' } });
    expect(stored(asked.deliveryId)?.state).toBe('pending');
  });

  it('refuses when the sender is retired, sending nothing and leaving the message open', async () => {
    const asked = await toArgo();
    unwrap(await registryUseCases(core).retireShip(operator, { shipId: captain.shipId }));
    const messages = core.state.messages.length;

    await expect(
      useCases.replyToMessage(argo, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'reply-go' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'UNRESOLVABLE_SELECTOR' } });
    expect(core.state.messages).toHaveLength(messages);
    expect(stored(asked.deliveryId)?.state).toBe('pending');
  });

  it("refuses a delivery that is not in argo's inbox, sending nothing", async () => {
    const { messageId } = unwrap(
      await useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: captain.shipId }, payload: 'hi', idempotencyKey: 'hi' }),
    );
    const messages = core.state.messages.length;

    await expect(
      useCases.replyToMessage(argo, { deliveryId: deliveryIdOf(core, messageId), payload: 'go', idempotencyKey: 'reply-go' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND' } });
    expect(core.state.messages).toHaveLength(messages);
  });

  it('refuses a delivery the fleet does not have', async () => {
    await expect(
      useCases.replyToMessage(argo, { deliveryId: core.ids('delivery'), payload: 'go', idempotencyKey: 'reply-go' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'DELIVERY_NOT_FOUND' } });
  });

  it('refuses any ship but argo', async () => {
    const asked = await toArgo();

    await expect(
      useCases.replyToMessage(captain, { deliveryId: asked.deliveryId, payload: 'go', idempotencyKey: 'reply-go' }),
    ).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR_SHIP' } });
  });
});
