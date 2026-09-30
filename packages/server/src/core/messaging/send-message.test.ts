import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  addAgentShip,
  agentCaller,
  initialiseFleet,
  messagingUseCases,
  operatorCaller,
  registryUseCases,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import type { SendMessage } from './send-message.js';

let core: InMemoryCore;
let sendMessage: SendMessage;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;
let scoutId: ShipId;
let scout: Caller;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(
    await registryUseCases(core).commissionShip(argo, { name: 'scout', type: 'reviewer' }),
  ));
  scout = agentCaller({ fleetId, shipId: scoutId });
  sendMessage = messagingUseCases(core).sendMessage;
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

/** A message to review a pull request, as JSON, with a key of its own unless told otherwise. */
function aReview(overrides: Partial<Parameters<SendMessage>[1]> = {}): Parameters<SendMessage>[1] {
  return {
    selector: { kind: 'ship', shipId: scoutId },
    payload: '{"review":"https://github.com/ThomasHendrickx/aeolus-fleet/pull/22"}',
    contentType: 'application/json',
    idempotencyKey: `review-${core.ids('message')}`,
    ...overrides,
  };
}

async function sent(caller: Caller, input: Parameters<SendMessage>[1]): Promise<MessageId> {
  return unwrap(await sendMessage(caller, input)).messageId;
}

describe('sending a message to a ship', () => {
  it('stores the message from the calling ship with one pending delivery to the ship, and returns its id', async () => {
    const input = aReview();

    const messageId = await sent(argo, input);

    expect(messageId).toMatch(/^msg_/);
    expect(core.state.messages).toEqual([
      {
        id: messageId,
        fleetId,
        senderShipId: argoId,
        selector: { kind: 'ship', shipId: scoutId },
        payload: input.payload,
        contentType: 'application/json',
        idempotencyKey: input.idempotencyKey,
        inReplyToMessageId: null,
        createdAt: core.clock.now(),
      },
    ]);
    const [delivery] = core.state.deliveries;
    expect(delivery?.id).toMatch(/^dlv_/);
    expect(core.state.deliveries).toEqual([
      {
        id: delivery?.id,
        fleetId,
        messageId,
        recipient: { kind: 'ship', shipId: scoutId },
        state: 'pending',
        claimedByShipId: null,
        attempts: 0,
        createdAt: core.clock.now(),
      },
    ]);
  });

  it("resolves a name to the ship's id at send time: a ship that takes the name later never gets the message", async () => {
    const messageId = await sent(argo, aReview({ selector: { kind: 'ship', name: 'scout' } }));
    const retired = core.state.ships.find((ship) => ship.id === scoutId);
    if (retired) {
      retired.retiredAt = core.clock.now();
    }
    const { shipId: newScoutId } = unwrap(
      await registryUseCases(core).commissionShip(argo, { name: 'scout', type: 'reviewer' }),
    );

    const laterId = await sent(argo, aReview({ selector: { kind: 'ship', name: 'scout' } }));

    expect(core.state.messages.map((message) => [message.id, message.selector])).toEqual([
      [messageId, { kind: 'ship', shipId: scoutId }],
      [laterId, { kind: 'ship', shipId: newScoutId }],
    ]);
    expect(core.state.deliveries.map((delivery) => delivery.recipient)).toEqual([
      { kind: 'ship', shipId: scoutId },
      { kind: 'ship', shipId: newScoutId },
    ]);
  });

  it('reaches argo from an agent ship, by name and by id', async () => {
    await sent(scout, aReview({ selector: { kind: 'ship', name: 'argo' } }));
    await sent(scout, aReview({ selector: { kind: 'ship', shipId: argoId } }));

    expect(core.state.deliveries.map((delivery) => delivery.recipient)).toEqual([
      { kind: 'ship', shipId: argoId },
      { kind: 'ship', shipId: argoId },
    ]);
    expect(core.state.messages.map((message) => message.senderShipId)).toEqual([scoutId, scoutId]);
  });

  it('takes the payload exactly as sent, whatever its content type says: it is never parsed', async () => {
    await sent(argo, aReview({ payload: '  {not json ', contentType: 'application/json' }));
    await sent(argo, aReview({ payload: '', contentType: 'text/plain' }));

    expect(core.state.messages.map((message) => [message.payload, message.contentType])).toEqual([
      ['  {not json ', 'application/json'],
      ['', 'text/plain'],
    ]);
  });

  it.each([
    { label: 'one-byte characters', payload: 'a'.repeat(65_536) },
    { label: 'two-byte characters', payload: 'é'.repeat(32_768) },
  ])('accepts a payload of exactly 64 KB in $label', async ({ payload }) => {
    await sent(argo, aReview({ payload }));

    expect(core.state.messages.map((message) => message.payload)).toEqual([payload]);
  });

  it("writes MessageAccepted, caused by the sender, on the recipient's timeline", async () => {
    const messageId = await sent(argo, aReview());

    const [event] = core.state.events;
    expect(event?.id).toMatch(/^evt_/);
    expect(core.state.events).toEqual([
      {
        id: event?.id,
        fleetId,
        type: 'MessageAccepted',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId: scoutId,
        messageId,
        deliveryId: core.state.deliveries[0]?.id,
        details: { selector: 'ship', recipientType: null },
      },
    ]);
  });

  it('wakes the receivers of the delivery: one notice, sent with the transaction', async () => {
    await sent(argo, aReview());

    expect(core.state.notices).toEqual([
      { fleetId, deliveryId: core.state.deliveries[0]?.id, recipient: { kind: 'ship', shipId: scoutId } },
    ]);
  });
});

describe('sending a message to a type', () => {
  it('stores one delivery for the type queue, on no ship yet', async () => {
    const messageId = await sent(argo, aReview({ selector: { kind: 'type', type: 'reviewer' } }));

    expect(core.state.messages[0]?.selector).toEqual({ kind: 'type', type: 'reviewer' });
    expect(core.state.deliveries).toEqual([
      expect.objectContaining({
        messageId,
        recipient: { kind: 'type', type: 'reviewer' },
        state: 'pending',
        claimedByShipId: null,
      }),
    ]);
    expect(core.state.notices).toEqual([
      { fleetId, deliveryId: core.state.deliveries[0]?.id, recipient: { kind: 'type', type: 'reviewer' } },
    ]);
  });

  it('writes MessageAccepted naming the type, on no ship', async () => {
    await sent(scout, aReview({ selector: { kind: 'type', type: 'reviewer' } }));

    const [event] = core.state.events;
    expect(event).toMatchObject({
      type: 'MessageAccepted',
      actor: { kind: 'ship', shipId: scoutId },
      details: { selector: 'type', recipientType: 'reviewer' },
    });
    expect(event?.shipId).toBeUndefined();
  });

  it('accepts a type whose one active ship still awaits crew: the message waits', async () => {
    addAgentShip(core, { fleetId, type: 'lookout' });

    await expect(sendMessage(argo, aReview({ selector: { kind: 'type', type: 'lookout' } }))).resolves.toMatchObject({
      isOk: true,
    });
  });
});

describe('a reply', () => {
  it('names the message it replies to', async () => {
    const question = await sent(scout, aReview({ selector: { kind: 'ship', name: 'argo' } }));

    const answer = await sent(argo, aReview({ inReplyTo: question }));

    expect(core.state.messages.find((message) => message.id === answer)?.inReplyToMessageId).toBe(question);
  });
});

describe('an idempotent repeat', () => {
  it('returns the original message id and stores nothing new, whatever else it says', async () => {
    const original = aReview();
    const messageId = await sent(argo, original);
    const before = structuredClone(core.state);
    core.clock.advance(60_000);

    const repeated = await sendMessage(argo, {
      ...original,
      selector: { kind: 'type', type: 'reviewer' },
      payload: 'something else',
    });

    expect(repeated).toEqual({ isOk: true, value: { messageId } });
    expect(core.state).toEqual(before);
  });

  it('returns the original even when its recipient was retired since', async () => {
    const original = aReview();
    const messageId = await sent(argo, original);
    const retired = core.state.ships.find((ship) => ship.id === scoutId);
    if (retired) {
      retired.retiredAt = core.clock.now();
    }

    await expect(sendMessage(argo, original)).resolves.toEqual({ isOk: true, value: { messageId } });
  });

  it('is a new message when another ship uses the same key', async () => {
    const idempotencyKey = 'review-22';

    const fromArgo = await sent(argo, aReview({ idempotencyKey }));
    const fromScout = await sent(scout, aReview({ idempotencyKey, selector: { kind: 'ship', name: 'argo' } }));

    expect(fromScout).not.toBe(fromArgo);
    expect(core.state.messages).toHaveLength(2);
  });

  it('is no repeat after a refusal: the key was never used, so the next send with it is stored', async () => {
    const idempotencyKey = 'review-22';
    await expect(
      sendMessage(argo, aReview({ idempotencyKey, selector: { kind: 'ship', name: 'lookout' } })),
    ).resolves.toMatchObject({ isOk: false });
    addAgentShip(core, { fleetId, name: 'lookout' });

    const messageId = await sent(argo, aReview({ idempotencyKey, selector: { kind: 'ship', name: 'lookout' } }));

    expect(core.state.messages.map((message) => message.id)).toEqual([messageId]);
  });
});

describe('a send refused', () => {
  /** Sends, expects the refusal, and proves the send left nothing behind: no message, delivery, event or notice. */
  async function expectRefused(input: Parameters<SendMessage>[1], error: { kind: string; message?: string }): Promise<void> {
    const before = structuredClone(core.state);

    await expect(sendMessage(argo, input)).resolves.toMatchObject({ isOk: false, error });

    expect(core.state).toEqual(before);
  }

  it('refuses an unknown ship id', async () => {
    const shipId = core.ids('ship');

    await expectRefused(aReview({ selector: { kind: 'ship', shipId } }), {
      kind: 'UNRESOLVABLE_SELECTOR',
      message: `Ship ${shipId} does not exist`,
    });
  });

  it("refuses the id of another fleet's ship as unknown", async () => {
    const { shipId } = addAgentShip(core, { fleetId: core.ids('fleet') });

    await expectRefused(aReview({ selector: { kind: 'ship', shipId } }), {
      kind: 'UNRESOLVABLE_SELECTOR',
      message: `Ship ${shipId} does not exist`,
    });
  });

  it('refuses an unknown name', async () => {
    await expectRefused(aReview({ selector: { kind: 'ship', name: 'lookout' } }), {
      kind: 'UNRESOLVABLE_SELECTOR',
      message: 'No active ship is named lookout',
    });
  });

  it('refuses a retired ship by its id', async () => {
    const { shipId } = addAgentShip(core, { fleetId, name: 'wreck', retiredAt: core.clock.now() });

    await expectRefused(aReview({ selector: { kind: 'ship', shipId } }), {
      kind: 'UNRESOLVABLE_SELECTOR',
      message: 'wreck is retired: a retired ship is never addressed again',
    });
  });

  it('refuses a retired ship by its name', async () => {
    addAgentShip(core, { fleetId, name: 'wreck', retiredAt: core.clock.now() });

    await expectRefused(aReview({ selector: { kind: 'ship', name: 'wreck' } }), {
      kind: 'UNRESOLVABLE_SELECTOR',
      message: 'No active ship is named wreck',
    });
  });

  it('refuses a type no ship has', async () => {
    await expectRefused(aReview({ selector: { kind: 'type', type: 'lookout' } }), {
      kind: 'UNRESOLVABLE_SELECTOR',
      message: 'No active ship has the type lookout',
    });
  });

  it('refuses a type whose ships are all retired', async () => {
    addAgentShip(core, { fleetId, type: 'lookout', retiredAt: core.clock.now() });

    await expectRefused(aReview({ selector: { kind: 'type', type: 'lookout' } }), {
      kind: 'UNRESOLVABLE_SELECTOR',
      message: 'No active ship has the type lookout',
    });
  });

  it("refuses a type only another fleet's ship has", async () => {
    addAgentShip(core, { fleetId: core.ids('fleet'), type: 'lookout' });

    await expectRefused(aReview({ selector: { kind: 'type', type: 'lookout' } }), { kind: 'UNRESOLVABLE_SELECTOR' });
  });

  it.each([
    { label: 'one-byte characters', payload: 'a'.repeat(65_537), bytes: 65_537 },
    { label: 'two-byte characters and one more byte', payload: `${'é'.repeat(32_768)}a`, bytes: 65_537 },
    { label: 'four-byte characters', payload: '😀'.repeat(16_385), bytes: 65_540 },
  ])('refuses a payload over 64 KB, counted in UTF-8 bytes: $label', async ({ payload, bytes }) => {
    await expectRefused(aReview({ payload }), {
      kind: 'PAYLOAD_TOO_LARGE',
      message: `A payload is at most 65536 bytes (64 KB) in UTF-8, not ${bytes}`,
    });
  });

  it('refuses a reply to a message that does not exist', async () => {
    const inReplyTo = core.ids('message');

    await expectRefused(aReview({ inReplyTo }), {
      kind: 'IN_REPLY_TO_NOT_FOUND',
      message: `Message ${inReplyTo} does not exist: a reply names a message of the fleet`,
    });
  });

  it("refuses a reply to another fleet's message", async () => {
    const otherFleetId = core.ids('fleet');
    const inReplyTo = core.ids('message');
    core.state.messages.push({
      id: inReplyTo,
      fleetId: otherFleetId,
      senderShipId: addAgentShip(core, { fleetId: otherFleetId }).shipId,
      selector: { kind: 'type', type: 'reviewer' },
      payload: 'elsewhere',
      contentType: 'text/plain',
      idempotencyKey: 'elsewhere',
      inReplyToMessageId: null,
      createdAt: core.clock.now(),
    });

    await expectRefused(aReview({ inReplyTo }), { kind: 'IN_REPLY_TO_NOT_FOUND' });
  });

  it.each([
    { label: 'an empty idempotency key', idempotencyKey: '' },
    { label: 'an idempotency key over 256 characters', idempotencyKey: 'k'.repeat(257) },
  ])('refuses $label', async ({ idempotencyKey }) => {
    await expectRefused(aReview({ idempotencyKey }), {
      kind: 'INVALID_IDEMPOTENCY_KEY',
      message: 'An idempotency key is 1 to 256 characters',
    });
  });
});
