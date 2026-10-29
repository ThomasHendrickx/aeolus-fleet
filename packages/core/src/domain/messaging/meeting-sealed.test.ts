import { MEETING_ADDED_CONTENT_TYPE, MEETING_ENDED_CONTENT_TYPE, MEETING_MIC_CONTENT_TYPE, meetingAddedSchema, type MeetingId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleet, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { DATA_KEY_CACHE_MS } from './data-keys.js';
import { isSealedPayload } from './sealed-payload.js';

/**
 * A meeting in a sealed fleet (decision 0068, B17): chief opens a meeting
 * with marketing and product. Every payload it stores is sealed, the
 * contributions and the notices core writes alike, and each reads as written.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: ShipCaller;
let chief: ShipCaller;
let marketing: ShipCaller;
let product: ShipCaller;
let design: ShipCaller;
let meetingId: MeetingId;
let companyKey: string;

/** A payload with bytes past ASCII, so it comes back exactly or not at all. */
const CONTRIBUTION = 'Launch copy for the café: 5 € off';

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: ['meetings:open'] });
  marketing = await shipWithScopes({ registry, argo }, { name: 'marketing', type: 'head', scopes: [] });
  product = await shipWithScopes({ registry, argo }, { name: 'product', type: 'head', scopes: [] });
  design = await shipWithScopes({ registry, argo }, { name: 'design', type: 'head', scopes: [] });
  companyKey = await sealFleet(core, fleet.fleetId);
  ({ meetingId } = unwrap(await messaging.openMeeting(chief, { ships: [{ shipId: marketing.shipId }, { shipId: product.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL, title: 'Launch' })));
});

/** What the ship's crew receives: each delivery's content type and payload. */
async function receivedBy(ship: ShipCaller): Promise<{ contentType: string; payload: string }[]> {
  const { deliveries } = unwrap(await messaging.receiveDeliveries(crewAboard(core, ship), { max: 10 }));
  return deliveries.map(({ contentType, payload }) => ({ contentType, payload }));
}

function noPayloadStoredPlain(): void {
  expect(core.state.messages.filter((message) => !isSealedPayload(message.payload))).toEqual([]);
  expect(JSON.stringify(core.state.messages)).not.toContain('Launch');
}

describe('a meeting in a sealed fleet (decision 0068, B17)', () => {
  it('stores the added notices of opening a meeting sealed, and each participant receives its notice as written', async () => {
    const received = await receivedBy(marketing);

    noPayloadStoredPlain();
    expect(received.map(({ contentType, payload }) => ({ contentType, notice: meetingAddedSchema.parse(JSON.parse(payload)) }))).toMatchObject([{ contentType: MEETING_ADDED_CONTENT_TYPE, notice: { meetingId, title: 'Launch' } }]);
  });

  it('stores the added notice of a ship added to the meeting sealed, and the ship receives it as written', async () => {
    unwrap(await messaging.addToMeeting(chief, { meetingId, ships: [{ shipId: design.shipId }], model: SESSION_MODEL }));

    const received = await receivedBy(design);

    noPayloadStoredPlain();
    expect(received.map(({ contentType, payload }) => ({ contentType, notice: meetingAddedSchema.parse(JSON.parse(payload)) }))).toMatchObject([{ contentType: MEETING_ADDED_CONTENT_TYPE, notice: { meetingId, title: 'Launch' } }]);
  });

  it("stores the moderator's contribution sealed, and the meeting read answers it as written", async () => {
    unwrap(await messaging.sendMessage(chief, { selector: { kind: 'meeting', meetingId }, payload: CONTRIBUTION, idempotencyKey: newKey(), model: SESSION_MODEL }));

    const read = unwrap(await messaging.readMeeting(product, { meetingId, limit: 10 }));

    noPayloadStoredPlain();
    expect(read.contributions.items.map(({ payload }) => payload)).toEqual([CONTRIBUTION]);
  });

  it('stores the mic notice sealed, and the ship given the mic receives it as written', async () => {
    unwrap(await messaging.changeMic(chief, { meetingId, change: { kind: 'give', shipId: product.shipId } }));

    const received = await receivedBy(product);

    noPayloadStoredPlain();
    expect(received.filter(({ contentType }) => contentType === MEETING_MIC_CONTENT_TYPE)).toEqual([{ contentType: MEETING_MIC_CONTENT_TYPE, payload: JSON.stringify({ meetingId }) }]);
  });

  it('stores the ended notices sealed, and each participant receives its notice as written', async () => {
    unwrap(await messaging.changeMeeting(chief, { meetingId, change: { kind: 'end' } }));

    const received = await receivedBy(marketing);

    noPayloadStoredPlain();
    expect(received.filter(({ contentType }) => contentType === MEETING_ENDED_CONTENT_TYPE)).toEqual([{ contentType: MEETING_ENDED_CONTENT_TYPE, payload: JSON.stringify({ meetingId }) }]);
  });

  it('stores the ended notices of a retired owner sealed, and each participant receives its notice as written', async () => {
    unwrap(await registry.retireShip(argo, { shipId: chief.shipId }));

    const received = await receivedBy(product);

    noPayloadStoredPlain();
    expect(received.filter(({ contentType }) => contentType === MEETING_ENDED_CONTENT_TYPE)).toEqual([{ contentType: MEETING_ENDED_CONTENT_TYPE, payload: JSON.stringify({ meetingId }) }]);
  });

  it('with the company key cut off, the meeting read marks each contribution it cannot unseal unreadable and answers the meeting (B9)', async () => {
    const { messageId } = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'meeting', meetingId }, payload: CONTRIBUTION, idempotencyKey: newKey(), model: SESSION_MODEL }));
    await core.keyVault.disable(companyKey);
    core.clock.advance(DATA_KEY_CACHE_MS);

    const read = unwrap(await messaging.readMeeting(product, { meetingId, limit: 10 }));

    expect(read.title).toBe('Launch');
    expect(read.contributions.items.map(({ messageId: id, sender, payload }) => ({ id, sender: sender.name, payload }))).toEqual([{ id: messageId, sender: 'chief', payload: { kind: 'unreadable' } }]);
  });
});
