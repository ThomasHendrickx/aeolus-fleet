import { idSchema, type MeetingId, type MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { createReadMeeting } from './read-meeting.js';

/**
 * Reading a meeting (decision 0061, M12 and M14): chief opens a meeting with
 * marketing and product; engineering takes no part.
 */
let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: ShipCaller;
let chief: ShipCaller;
let marketing: ShipCaller;
let product: ShipCaller;
let engineering: ShipCaller;
let meetingId: MeetingId;

const OPENED_AT = '2026-10-24T09:00:00.000Z';

/** A contribution by the ship, which the moderator gives the mic first unless it is the moderator (M7). */
async function contributed(by: ShipCaller, payload: string): Promise<MessageId> {
  if (by.shipId !== chief.shipId) {
    unwrap(await messaging.changeMic(chief, { meetingId, change: { kind: 'give', shipId: by.shipId } }));
  }
  core.clock.advance(1_000);
  return unwrap(await messaging.sendMessage(by, { selector: { kind: 'meeting', meetingId }, payload, idempotencyKey: newKey(), model: SESSION_MODEL })).messageId;
}

beforeEach(async () => {
  core = createInMemoryCore(OPENED_AT);
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: ['meetings:open'] });
  marketing = await shipWithScopes({ registry, argo }, { name: 'marketing', type: 'head', scopes: [] });
  product = await shipWithScopes({ registry, argo }, { name: 'product', type: 'head', scopes: [] });
  engineering = await shipWithScopes({ registry, argo }, { name: 'engineering', type: 'head', scopes: [] });
  ({ meetingId } = unwrap(await messaging.openMeeting(chief, { ships: [{ shipId: marketing.shipId }, { shipId: product.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL, title: 'Launch plan' })));
});

describe('reading a meeting', () => {
  it('shows the meeting, its title, its owner and moderator, when it opened, and that it is open', async () => {
    const read = unwrap(await messaging.readMeeting(marketing, { meetingId, limit: 20 }));

    expect({ ...read, participants: undefined, mic: undefined, contributions: undefined }).toEqual({
      meetingId,
      title: 'Launch plan',
      goal: null,
      endsAt: null,
      endAfterCalls: null,
      closedCalls: 0,
      call: null,
      owner: { id: chief.shipId, name: 'chief' },
      moderator: { id: chief.shipId, name: 'chief' },
      openedAt: new Date(OPENED_AT),
      endedAt: null,
      participants: undefined,
      mic: undefined,
      contributions: undefined,
    });
  });

  it('shows each participant with its name, kind and status, crewed or awaiting crew: a ship that is not there is a choice (M14)', async () => {
    crewAboard(core, marketing);

    const read = unwrap(await messaging.readMeeting(chief, { meetingId, limit: 20 }));

    expect(read.participants).toEqual([
      { id: chief.shipId, name: 'chief', kind: 'agent', status: 'awaitingCrew', state: 'present' },
      { id: marketing.shipId, name: 'marketing', kind: 'agent', status: 'crewed', state: 'present' },
      { id: product.shipId, name: 'product', kind: 'agent', status: 'awaitingCrew', state: 'present' },
    ]);
  });

  it('shows each former participant with its state, left or revoked, and lets it read the meeting (M13, M15)', async () => {
    unwrap(await messaging.changeMeeting(marketing, { meetingId, change: { kind: 'leave' } }));
    unwrap(await messaging.changeMeeting(chief, { meetingId, change: { kind: 'revoke', shipId: product.shipId } }));

    const [byLeft, byRevoked] = [unwrap(await messaging.readMeeting(marketing, { meetingId, limit: 20 })), unwrap(await messaging.readMeeting(product, { meetingId, limit: 20 }))];

    expect(byLeft.participants.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: chief.shipId, state: 'present' },
      { id: marketing.shipId, state: 'left' },
      { id: product.shipId, state: 'revoked' },
    ]);
    expect(byRevoked.meetingId).toBe(meetingId);
  });

  it('shows who holds the mic, how it passes, and who waits for it, oldest first with their time (M8, M9)', async () => {
    core.clock.advance(1_000);
    unwrap(await messaging.changeMic(product, { meetingId, change: { kind: 'request' } }));
    core.clock.advance(1_000);
    unwrap(await messaging.changeMic(marketing, { meetingId, change: { kind: 'request' } }));
    unwrap(await messaging.changeMic(chief, { meetingId, change: { kind: 'give', shipId: marketing.shipId } }));

    expect(unwrap(await messaging.readMeeting(product, { meetingId, limit: 20 })).mic).toEqual({
      holder: { id: marketing.shipId, name: 'marketing' },
      pattern: 'moderator',
      requests: [{ ship: { id: product.shipId, name: 'product' }, requestedAt: new Date('2026-10-24T09:00:01.000Z') }],
    });
  });

  it('shows what was said so far, newest first, with its sender, payload, content type, model and time, and no notice (M12)', async () => {
    const first = await contributed(chief, 'Agenda: the launch');
    const second = await contributed(product, 'Friday works');

    const read = unwrap(await messaging.readMeeting(marketing, { meetingId, limit: 20 }));

    expect(read.contributions).toEqual({
      items: [
        { messageId: second, callId: null, isLate: false, senderLeaseId: null, sender: { id: product.shipId, name: 'product' }, payload: 'Friday works', contentType: 'text/plain', model: SESSION_MODEL, sentAt: new Date('2026-10-24T09:00:02.000Z') },
        { messageId: first, callId: null, isLate: false, senderLeaseId: null, sender: { id: chief.shipId, name: 'chief' }, payload: 'Agenda: the launch', contentType: 'text/plain', model: SESSION_MODEL, sentAt: new Date('2026-10-24T09:00:01.000Z') },
      ],
      nextCursor: null,
    });
  });

  it('pages what was said by cursor, the next page going on after the last one', async () => {
    const said = [await contributed(chief, 'one'), await contributed(marketing, 'two'), await contributed(product, 'three')];

    const firstPage = unwrap(await messaging.readMeeting(chief, { meetingId, limit: 2 })).contributions;
    const secondPage = unwrap(await messaging.readMeeting(chief, { meetingId, limit: 2, cursor: firstPage.nextCursor ?? undefined })).contributions;

    expect([firstPage.items.map(({ messageId }) => messageId), firstPage.nextCursor, secondPage.items.map(({ messageId }) => messageId), secondPage.nextCursor]).toEqual([
      [said[2], said[1]],
      said[1],
      [said[0]],
      null,
    ]);
  });

  it('lets a reached person read the full meeting before joining without changing it', async () => {
    // Given a contribution and a person who has not joined.
    const registry = registryUseCases(core);
    const { shipId } = unwrap(await registry.commissionShip(argo, { name: 'person', type: 'person', kind: 'person', idempotencyKey: newKey() }));
    const person: ShipCaller = { fleetId: chief.fleetId, shipId, kind: 'person', scopes: ['messages:receive'] };
    await contributed(chief, 'Agenda');
    const expected = unwrap(await messaging.readMeeting(marketing, { meetingId, limit: 20 }));
    const before = structuredClone({ meetings: core.state.meetings, messages: core.state.messages, events: core.state.events });

    // When the person reads it.
    const read = unwrap(await messaging.readMeeting(person, { meetingId, limit: 20 }));

    // Then it sees the participant's full view and the read changes nothing.
    expect(read).toEqual(expected);
    expect({ meetings: core.state.meetings, messages: core.state.messages, events: core.state.events }).toEqual(before);
  });

  it('refuses a person outside the meeting owner\'s reach', async () => {
    // Given a person outside the owner's reach.
    const registry = registryUseCases(core);
    const { shipId } = unwrap(await registry.commissionShip(argo, { name: 'person', type: 'person', kind: 'person', idempotencyKey: newKey() }));
    const person: ShipCaller = { fleetId: chief.fleetId, shipId, kind: 'person', scopes: ['messages:receive'] };
    await applyNetworkRules(registry, { by: argo, rules: [] });

    // When it reads the meeting, then it is refused.
    expect(refusalOf(await messaging.readMeeting(person, { meetingId, limit: 20 })).kind).toBe('MEETING_NOT_FOUND');
  });

  it('leaves all state unchanged without recording a refused person read', async () => {
    // Given a person outside the owner's reach and the state before reading.
    const registry = registryUseCases(core);
    const { shipId } = unwrap(await registry.commissionShip(argo, { name: 'person', type: 'person', kind: 'person', idempotencyKey: newKey() }));
    const person: ShipCaller = { fleetId: chief.fleetId, shipId, kind: 'person', scopes: ['messages:receive'] };
    await applyNetworkRules(registry, { by: argo, rules: [] });
    const before = structuredClone(core.state);
    let refusalWrites = 0;
    const readMeeting = createReadMeeting({
      uow: { run: (work) => core.uow.run((tx) => {
        const observed = { ...tx, reachRefusals: { ...tx.reachRefusals, record: async (refusal: Parameters<typeof tx.reachRefusals.record>[0]) => { refusalWrites += 1; await tx.reachRefusals.record(refusal); } } };
        return work(observed);
      }) },
      sealing: core.sealing,
    });

    // When the person reads the meeting.
    const result = await readMeeting(person, { meetingId, limit: 20 });

    // Then it is refused without writing a refusal or changing any state.
    expect(refusalOf(result).kind).toBe('MEETING_NOT_FOUND');
    expect(refusalWrites).toBe(0);
    expect(core.state.reachRefusals).toEqual(before.reachRefusals);
    expect(core.state).toEqual(before);
  });

  it('refuses a ship that is no participant, as it refuses a meeting that does not exist', async () => {
    const unknown = core.ids('meeting');

    expect([refusalOf(await messaging.readMeeting(engineering, { meetingId, limit: 20 })), refusalOf(await messaging.readMeeting(chief, { meetingId: unknown, limit: 20 }))]).toEqual([
      { kind: 'MEETING_NOT_FOUND', message: `Meeting ${meetingId} does not exist or you are not one of its participants` },
      { kind: 'MEETING_NOT_FOUND', message: `Meeting ${unknown} does not exist or you are not one of its participants` },
    ]);
  });
});


it('projects the immutable sending lease on full meeting contributions (#1993)', async () => {
  // Given
  const crew = crewAboard(core, chief);
  const messageId = await contributed(crew, 'I accept these instructions');

  // When
  const read = unwrap(await messaging.readMeeting(product, { meetingId, limit: 20 }));

  // Then
  expect(read.contributions.items).toContainEqual(expect.objectContaining({ messageId, senderLeaseId: crew.leaseId }));
});


describe('round progress in one meeting read', () => {
  async function openedCall() {
    crewAboard(core, chief);
    const crew = crewAboard(core, marketing);
    const { callId } = unwrap(await messaging.openCall(chief, { meetingId, question: 'Ready?', idempotencyKey: newKey(), model: SESSION_MODEL }));
    return { callId, crew };
  }
  it('shows delivered progress with current crew state', async () => {
    // Given
    await openedCall();
    // When
    const read = unwrap(await messaging.readMeeting(chief, { meetingId, limit: 20 }));
    // Then
    expect(read.call?.progress.items).toContainEqual({ ship: { id: marketing.shipId, name: 'marketing' }, progress: 'delivered', status: 'crewed', turn: null, deliveredAt: new Date(OPENED_AT), acknowledgedAt: null });
  });
  it('shows immediate silence for an expected ship awaiting crew', async () => {
    // Given
    await openedCall();
    // When
    const read = unwrap(await messaging.readMeeting(chief, { meetingId, limit: 20 }));
    // Then
    expect(read.call?.progress.items).toContainEqual(expect.objectContaining({ ship: { id: product.shipId, name: 'product' }, progress: 'silent', status: 'awaitingCrew', turn: null }));
  });
  it.each([{ who: 'marketing', progress: 'answered' }, { who: 'product', progress: 'late' }])('shows $progress progress for $who', async ({ who, progress }) => {
    // Given
    const { callId } = await openedCall();
    const ship = who === 'marketing' ? marketing : product;
    // When
    unwrap(await messaging.sendMessage(ship, { selector: { kind: 'meeting', meetingId }, callId, payload: 'Ready', idempotencyKey: newKey(), model: SESSION_MODEL }));
    // Then
    expect(unwrap(await messaging.readMeeting(chief, { meetingId, limit: 20 })).call?.progress.items).toContainEqual(expect.objectContaining({ ship: { id: ship.shipId, name: who }, progress }));
  });
  it('keeps acknowledged progress after the crew ends its turn', async () => {
    // Given
    const { callId, crew } = await openedCall();
    const delivery = core.state.deliveries.find((held) => held.messageId === callId && held.recipient.kind === 'ship' && held.recipient.shipId === marketing.shipId);
    const marketingDeliveryId = idSchema('delivery').parse(delivery?.id);
    unwrap(await messaging.receiveDeliveries(crew, { max: 10 }));
    unwrap(await messaging.acknowledgeDelivery(crew, { deliveryId: marketingDeliveryId }));
    // When
    unwrap(await messaging.reportHandled(crew, { deliveryId: marketingDeliveryId }));
    // Then
    expect(unwrap(await messaging.readMeeting(chief, { meetingId, limit: 20 })).call?.progress.items).toContainEqual(expect.objectContaining({ ship: { id: marketing.shipId, name: 'marketing' }, progress: 'acknowledged', acknowledgedAt: new Date(OPENED_AT) }));
  });
});


it('reads the stored call question even when the opening payload is malformed', async () => {
  // Given a call whose opening contribution is no longer valid JSON.
  const { callId } = unwrap(await messaging.openCall(chief, { meetingId, question: 'Ready?', idempotencyKey: newKey(), model: SESSION_MODEL }));
  const message = core.state.messages.find((message) => message.id === callId);
  expect(message).toBeDefined();
  if (message === undefined) return;
  message.payload = 'invalid JSON';

  // When a participant reads the call.
  const read = unwrap(await messaging.readMeeting(product, { meetingId, limit: 20 }));

  // Then the question comes from the call, without parsing the contribution.
  expect(read.call).toMatchObject({ callId, question: 'Ready?' });
});
