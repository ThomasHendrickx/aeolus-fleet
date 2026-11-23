/** D8 and #2038: mark contribution deliveries read without clearing requests or meeting notices. */
import { MEETING_CALL_CONTENT_TYPE, type MeetingId, type MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew } from '../shared/caller.js';

let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let chief: Crew;
let reader: Crew;
let other: Crew;
let stranger: Crew;
let meetingId: MeetingId;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-24T09:00:00.000Z');
  const argo = operatorCaller(await initialiseFleet(core));
  const registry = registryUseCases(core);
  const ship = async (name: string) => crewAboard(core, await shipWithScopes({ registry, argo }, { name, type: 'agent', scopes: ['meetings:open'] }));
  chief = await ship('chief');
  reader = await ship('reader');
  other = await ship('other');
  stranger = await ship('stranger');
  messaging = messagingUseCases(core);
  ({ meetingId } = unwrap(await messaging.openMeeting(chief, { ships: [{ shipId: reader.shipId }, { shipId: other.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL })));
});

async function contribute(by: Crew = chief): Promise<MessageId> {
  if (by.shipId !== chief.shipId) unwrap(await messaging.changeMic(chief, { meetingId, change: { kind: 'give', shipId: by.shipId } }));
  core.clock.advance(1_000);
  return unwrap(await messaging.sendMessage(by, { selector: { kind: 'meeting', meetingId }, payload: 'A contribution', idempotencyKey: newKey(), model: SESSION_MODEL })).messageId;
}

function deliveryOf(messageId: MessageId, ship: Crew = reader) {
  return core.state.deliveries.find((delivery) => delivery.messageId === messageId && delivery.recipient.kind === 'ship' && delivery.recipient.shipId === ship.shipId);
}

describe('marking meeting contributions read up to a contribution', () => {
  it("acknowledges only this ship's pending contributions through the named contribution with one event", async () => {
    // Given contributions from two speakers, and another contribution after the chosen point.
    const first = await contribute();
    const upTo = await contribute(other);
    const after = await contribute();
    const events = core.state.events.length;

    // When the reader marks the meeting read up to the second contribution.
    const result = unwrap(await messaging.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }));

    // Then both earlier deliveries are acknowledged, the later one and other recipients stay pending, with just one event.
    expect(result).toEqual({ acknowledged: 2 });
    expect([first, upTo, after].map((id) => deliveryOf(id)?.state)).toEqual(['acknowledged', 'acknowledged', 'pending']);
    expect(deliveryOf(first, other)?.state).toBe('pending');
    expect(core.state.events.slice(events)).toHaveLength(1);
    expect(core.state.events.slice(events)[0]).toMatchObject({ type: 'MeetingReadUpTo', shipId: reader.shipId, messageId: upTo, details: { meetingId, acknowledged: 2 } });
    expect(deliveryOf(upTo)).toMatchObject({ claimedByShipId: reader.shipId, claimedByLeaseId: reader.leaseId, attempts: 0, handOverNumber: null });
  });

  it('keeps a call naming this ship, mic notices, added and ended notices pending', async () => {
    // Given every attention notice around a normal contribution, including an ended meeting.
    unwrap(await messaging.changeMic(chief, { meetingId, change: { kind: 'give', shipId: reader.shipId } }));
    unwrap(await messaging.openCall(chief, { meetingId, question: 'Your answer?', idempotencyKey: newKey(), model: SESSION_MODEL }));
    const upTo = await contribute();
    unwrap(await messaging.changeMeeting(chief, { meetingId, change: { kind: 'end' } }));
    const notices = core.state.messages.filter((message) => message.meetingId === meetingId && message.id !== upTo);
    expect(notices.some((message) => message.contentType === MEETING_CALL_CONTENT_TYPE)).toBe(true);

    // When the reader marks contributions read.
    expect(unwrap(await messaging.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }))).toEqual({ acknowledged: 1 });

    // Then notices are still waiting, including those older than the contribution.
    expect(notices.flatMap((message) => { const delivery = deliveryOf(message.id); return delivery === undefined ? [] : [delivery.state]; })).toEqual(['pending', 'pending', 'pending', 'pending']);
  });

  it('refuses a contribution outside the meeting, a notice, and a ship that is not a participant without changing anything', async () => {
    // Given another meeting contribution and this meeting's added notice.
    const elsewhere = unwrap(await messaging.openMeeting(chief, { ships: [{ shipId: stranger.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL })).meetingId;
    const foreign = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'meeting', meetingId: elsewhere }, payload: 'Elsewhere', idempotencyKey: newKey(), model: SESSION_MODEL })).messageId;
    const upTo = await contribute();
    const notice = core.state.messages.find((message) => message.meetingId === meetingId && message.selector.kind === 'ship');
    const before = structuredClone(core.state);

    // When invalid cutoffs or a stranger try to mark the meeting read.
    const results = [
      await messaging.acknowledgeMeetingUpTo(reader, { meetingId, messageId: foreign }),
      await messaging.acknowledgeMeetingUpTo(reader, { meetingId, messageId: notice?.id ?? core.ids('message') }),
      await messaging.acknowledgeMeetingUpTo(stranger, { meetingId, messageId: upTo }),
      await messaging.acknowledgeMeetingUpTo(reader, { meetingId: core.ids('meeting'), messageId: upTo }),
    ];

    // Then cutoffs are not found, outsiders learn nothing, and nothing changed.
    expect(results).toMatchObject([
      { isOk: false, error: { kind: 'MESSAGE_NOT_FOUND' } },
      { isOk: false, error: { kind: 'MESSAGE_NOT_FOUND' } },
      { isOk: false, error: { kind: 'MEETING_NOT_FOUND' } },
      { isOk: false, error: { kind: 'MEETING_NOT_FOUND' } },
    ]);
    expect(core.state).toEqual(before);
  });

  it('includes received and handed contributions without adding attempts or replacing their claims', async () => {
    // Given the added notice is acknowledged and two contributions were received and handed.
    const added = unwrap(await messaging.receiveDeliveries(reader, {})).deliveries[0];
    expect(added).toBeDefined();
    unwrap(await messaging.acknowledgeDelivery(reader, { deliveryId: added?.deliveryId ?? core.ids('delivery') }));
    const handed = await contribute();
    unwrap(await messaging.pushReceiveDeliveries(reader, {}));
    const handedDelivery = deliveryOf(handed);
    expect(handedDelivery).toBeDefined();
    unwrap(await messaging.handOverDelivery(reader, { deliveryId: handedDelivery?.id ?? core.ids('delivery'), handOverNumber: 1 }));
    const received = await contribute();
    unwrap(await messaging.pushReceiveDeliveries(reader, { max: 10 }));
    const pending = await contribute();
    const events = core.state.events.length;

    // When the reader marks through the pending contribution.
    const result = await messaging.acknowledgeMeetingUpTo(reader, { meetingId, messageId: pending });

    // Then all three outstanding states are acknowledged with a single event, preserving attempts.
    expect(unwrap(result)).toEqual({ acknowledged: 3 });
    expect([handed, received, pending].map((id) => deliveryOf(id)?.state)).toEqual(['acknowledged', 'acknowledged', 'acknowledged']);
    expect([handed, received, pending].map((id) => deliveryOf(id)?.attempts)).toEqual([1, 0, 0]);
    expect(core.state.events.slice(events)).toHaveLength(1);
  });

  it.each(['left', 'revoked'] as const)('lets a former participant mark retained contributions read after it was %s', async (state) => {
    // Given a contribution and a former participant that still reads the meeting.
    const upTo = await contribute();
    if (state === 'left') unwrap(await messaging.changeMeeting(reader, { meetingId, change: { kind: 'leave' } }));
    else unwrap(await messaging.changeMeeting(chief, { meetingId, change: { kind: 'revoke', shipId: reader.shipId } }));

    // When it marks the contribution read.
    const result = await messaging.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo });

    // Then its retained delivery is acknowledged.
    expect(unwrap(result)).toEqual({ acknowledged: 1 });
    expect(deliveryOf(upTo)?.state).toBe('acknowledged');
  });

  it('changes nothing on a repeated mark, returning zero and writing no further event', async () => {
    // Given the reader already marked a contribution read.
    const upTo = await contribute();
    unwrap(await messaging.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo }));
    const before = structuredClone(core.state);

    // When the same point is marked again.
    const result = await messaging.acknowledgeMeetingUpTo(reader, { meetingId, messageId: upTo });

    // Then the repeat is harmless.
    expect(unwrap(result)).toEqual({ acknowledged: 0 });
    expect(core.state).toEqual(before);
  });
});
