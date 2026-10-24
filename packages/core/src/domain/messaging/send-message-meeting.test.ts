import { PAYLOAD_MAX_BYTES, type LabelValueId, type MeetingId, type MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MessageToSend } from './send-message.js';

/**
 * Contributing to a meeting (decision 0061): a send to the meeting selector.
 * chief, holding meetings:open, opens a meeting with marketing and product.
 * Under the rules chief reaches both heads and no head reaches another, so
 * only the meeting lets them talk; engineering is a head left out of it.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: ShipCaller;
let chief: ShipCaller;
let marketing: ShipCaller;
let product: ShipCaller;
let engineering: ShipCaller;
let meetingId: MeetingId;
let networking: ShipCaller;

function value(key: string, text: string): LabelValueId {
  return valueIdOf(core, { key, value: text });
}

function aContribution(overrides: Partial<MessageToSend> = {}): MessageToSend {
  return { selector: { kind: 'meeting', meetingId }, payload: 'The launch moves to Friday: https://example.com/plan', idempotencyKey: newKey(), model: SESSION_MODEL, ...overrides };
}

/** Gives the ship the mic, unless it moderates or holds it already: only then may it contribute (M7). */
async function withTheMic(ship: ShipCaller): Promise<void> {
  const meeting = core.state.meetings.find(({ id }) => id === meetingId);
  if (ship.shipId !== chief.shipId && meeting?.micHolderShipId !== ship.shipId) {
    unwrap(await messaging.changeMic(chief, { meetingId, change: { kind: 'give', shipId: ship.shipId } }));
  }
}

/** A contribution by the ship, which gets the mic first, with what that stored and woke cleared. */
async function contributed(by: ShipCaller, input: MessageToSend = aContribution()): Promise<MessageId> {
  await withTheMic(by);
  clearEventsAndNotices();
  return unwrap(await messaging.sendMessage(by, input)).messageId;
}

function clearEventsAndNotices(): void {
  core.state.events.length = 0;
  core.state.notices.length = 0;
}

/** The deliveries of the message, each with its recipient and state. */
function deliveriesOf(messageId: MessageId) {
  return core.state.deliveries.filter((delivery) => delivery.messageId === messageId).map(({ recipient, state }) => ({ recipient, state }));
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-24T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: ['meetings:open', 'messages:force'] });
  marketing = await shipWithScopes({ registry, argo }, { name: 'marketing', type: 'head', scopes: [] });
  product = await shipWithScopes({ registry, argo }, { name: 'product', type: 'head', scopes: [] });
  engineering = await shipWithScopes({ registry, argo }, { name: 'engineering', type: 'head', scopes: [] });
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  unwrap(await registry.defineLabel(argo, { key: 'role', values: ['chief', 'head'] }));
  for (const [ship, role] of [
    [chief, 'chief'],
    [marketing, 'head'],
    [product, 'head'],
    [engineering, 'head'],
  ] as const) {
    unwrap(await registry.assignLabel(argo, { shipId: ship.shipId, valueId: value('role', role) }));
  }
  await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [value('role', 'chief')], to: [value('role', 'head')] }] });
  ({ meetingId } = unwrap(await messaging.openMeeting(chief, { ships: [{ shipId: marketing.shipId }, { shipId: product.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL })));
  core.clock.advance(60_000);
  clearEventsAndNotices();
});

describe('a contribution to a meeting', () => {
  it('reaches every other participant, one pending delivery each, though they do not reach each other', async () => {
    const messageId = await contributed(marketing);

    expect(deliveriesOf(messageId)).toEqual([
      { recipient: { kind: 'ship', shipId: chief.shipId }, state: 'pending' },
      { recipient: { kind: 'ship', shipId: product.shipId }, state: 'pending' },
    ]);
  });

  it('is one message, sent to the meeting and carrying it on its envelope', async () => {
    const messageId = await contributed(marketing);

    expect(core.state.messages.filter((message) => message.id === messageId).map(({ senderShipId, selector, meetingId: of }) => ({ senderShipId, selector, meetingId: of }))).toEqual([
      { senderShipId: marketing.shipId, selector: { kind: 'meeting', meetingId }, meetingId },
    ]);
  });

  it('reaches the participants from the moderator too', async () => {
    const messageId = await contributed(chief);

    expect(deliveriesOf(messageId).map(({ recipient }) => recipient)).toEqual([
      { kind: 'ship', shipId: marketing.shipId },
      { kind: 'ship', shipId: product.shipId },
    ]);
  });

  it('writes MessageAccepted for each delivery, naming its recipient and the meeting, and wakes each recipient', async () => {
    const messageId = await contributed(marketing);

    expect(core.state.events.filter((event) => event.type === 'MessageAccepted').map(({ shipId, messageId: of, details }) => ({ shipId, messageId: of, meetingId: details.meetingId, selector: details.selector }))).toEqual([
      { shipId: chief.shipId, messageId, meetingId, selector: 'meeting' },
      { shipId: product.shipId, messageId, meetingId, selector: 'meeting' },
    ]);
    expect(core.state.notices.map(({ recipient }) => recipient)).toEqual([
      { kind: 'ship', shipId: chief.shipId },
      { kind: 'ship', shipId: product.shipId },
    ]);
  });

  it('is received with the meeting it was sent to, and acknowledged by each recipient on its own', async () => {
    const messageId = await contributed(marketing);
    const productCrew = crewAboard(core, product);

    const [received] = unwrap(await messaging.receiveDeliveries(productCrew, { max: 10 })).deliveries.filter((delivery) => delivery.messageId === messageId);
    unwrap(await messaging.acknowledgeDelivery(productCrew, { deliveryId: received?.deliveryId ?? core.ids('delivery') }));

    expect(received?.meetingId).toBe(meetingId);
    expect(deliveriesOf(messageId).map(({ state }) => state)).toEqual(['pending', 'acknowledged']);
  });

  it('answers a repeat of the same request with the same key with the same message, storing nothing new', async () => {
    const input = aContribution();
    const messageId = await contributed(marketing, input);

    await expect(contributed(marketing, input)).resolves.toBe(messageId);
    expect(deliveriesOf(messageId)).toHaveLength(2);
  });

  it(`takes a payload of exactly ${String(PAYLOAD_MAX_BYTES)} bytes`, async () => {
    const messageId = await contributed(marketing, aContribution({ payload: 'a'.repeat(PAYLOAD_MAX_BYTES) }));

    expect(deliveriesOf(messageId)).toHaveLength(2);
  });
});

describe('a contribution the meeting refuses', () => {
  beforeEach(async () => {
    await withTheMic(marketing);
    clearEventsAndNotices();
  });

  /** That nothing of a refused contribution was stored: no message, delivery, event or wake-up. */
  function expectNothingStored(messagesBefore: number): void {
    expect([core.state.messages.length, core.state.events, core.state.notices]).toEqual([messagesBefore, [], []]);
  }

  it('refuses a ship that is no participant, as it refuses a meeting that does not exist', async () => {
    const before = core.state.messages.length;
    const unknown = core.ids('meeting');

    expect(refusalOf(await messaging.sendMessage(engineering, aContribution()))).toEqual({
      kind: 'MEETING_NOT_FOUND',
      message: `Meeting ${meetingId} does not exist or you are not one of its participants`,
    });
    expect(refusalOf(await messaging.sendMessage(marketing, aContribution({ selector: { kind: 'meeting', meetingId: unknown } })))).toEqual({
      kind: 'MEETING_NOT_FOUND',
      message: `Meeting ${unknown} does not exist or you are not one of its participants`,
    });
    expectNothingStored(before);
  });

  it('refuses a contribution that names a message it replies to (M18)', async () => {
    const asked = await contributed(chief);
    clearEventsAndNotices();
    const before = core.state.messages.length;

    expect(refusalOf(await messaging.sendMessage(marketing, aContribution({ inReplyTo: asked })))).toEqual({
      kind: 'CONTRIBUTION_REPLIES',
      message: 'A contribution replies to no message: send it to the meeting without inReplyTo',
    });
    expectNothingStored(before);
  });

  it('refuses a forced contribution, even from a ship holding messages:force', async () => {
    const before = core.state.messages.length;

    expect(refusalOf(await messaging.sendMessage(chief, aContribution({ isForced: true })))).toEqual({
      kind: 'CONTRIBUTION_FORCED',
      message: 'A contribution is never forced: send it to the meeting without isForced',
    });
    expectNothingStored(before);
  });

  it('refuses a contribution to an ended meeting', async () => {
    const before = core.state.messages.length;
    for (const meeting of core.state.meetings) {
      meeting.endedAt = new Date('2026-10-24T09:30:00.000Z');
    }

    expect(refusalOf(await messaging.sendMessage(marketing, aContribution()))).toEqual({
      kind: 'MEETING_ENDED',
      message: `Meeting ${meetingId} ended: it takes no more contributions`,
    });
    expectNothingStored(before);
  });

  it('refuses a contribution from a participant without the mic, telling it to request the mic (M7)', async () => {
    const before = core.state.messages.length;

    expect(refusalOf(await messaging.sendMessage(product, aContribution()))).toEqual({
      kind: 'MIC_NOT_HELD',
      message: `You do not hold the mic of meeting ${meetingId}: request the mic, and contribute once it is given to you`,
    });
    expectNothingStored(before);
  });

  it('refuses a contribution from the holder once the moderator took the mic back', async () => {
    unwrap(await messaging.changeMic(chief, { meetingId, change: { kind: 'take' } }));
    clearEventsAndNotices();
    const before = core.state.messages.length;

    expect(refusalOf(await messaging.sendMessage(marketing, aContribution())).kind).toBe('MIC_NOT_HELD');
    expectNothingStored(before);
  });

  it(`refuses a payload of one byte over ${String(PAYLOAD_MAX_BYTES)}`, async () => {
    const before = core.state.messages.length;

    expect(refusalOf(await messaging.sendMessage(marketing, aContribution({ payload: 'a'.repeat(PAYLOAD_MAX_BYTES + 1) }))).kind).toBe('PAYLOAD_TOO_LARGE');
    expectNothingStored(before);
  });
});

describe('an answer to a contribution', () => {
  it('gets no answer reach: a direct answer to its sender is checked as any send (M18)', async () => {
    const asked = await contributed(marketing);
    // Once no rule lets chief reach marketing, only the answer rule could let chief answer it.
    await applyNetworkRules(registry, { by: networking, rules: [] });

    const answered = await messaging.sendMessage(chief, { selector: { kind: 'ship', shipId: marketing.shipId }, payload: 'Friday works', idempotencyKey: newKey(), model: SESSION_MODEL, inReplyTo: asked });

    expect(refusalOf(answered)).toEqual({ kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' });
  });

  it('leaves the answer to a direct message as it is: its recipient still answers its sender', async () => {
    const asked = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'ship', shipId: marketing.shipId }, payload: 'Ready for Friday?', idempotencyKey: newKey(), model: SESSION_MODEL })).messageId;

    const answered = await messaging.sendMessage(marketing, { selector: { kind: 'ship', shipId: chief.shipId }, payload: 'Ready', idempotencyKey: newKey(), model: SESSION_MODEL, inReplyTo: asked });

    expect(answered.isOk).toBe(true);
  });
});
