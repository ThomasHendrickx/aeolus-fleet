import { MEETING_ENDED_CONTENT_TYPE, type MeetingId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * Retiring a ship that takes part in a meeting (decision 0061, M15, M17):
 * chief opens a meeting with marketing, product and design, owning and
 * moderating it; argo retires one of them.
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

function theMeeting() {
  return core.state.meetings.find(({ id }) => id === meetingId);
}

function presentShips() {
  return theMeeting()?.participants.filter(({ leftAt }) => leftAt === null).map(({ shipId }) => shipId);
}

async function retired(ship: ShipCaller): Promise<void> {
  core.clock.advance(1_000);
  unwrap(await registry.retireShip(argo, { shipId: ship.shipId }));
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-24T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: ['meetings:open'] });
  marketing = await shipWithScopes({ registry, argo }, { name: 'marketing', type: 'head', scopes: [] });
  product = await shipWithScopes({ registry, argo }, { name: 'product', type: 'head', scopes: [] });
  design = await shipWithScopes({ registry, argo }, { name: 'design', type: 'head', scopes: [] });
  ({ meetingId } = unwrap(
    await messaging.openMeeting(chief, { ships: [{ shipId: marketing.shipId }, { shipId: product.shipId }, { shipId: design.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL }),
  ));
});

describe('a retired participant (M17)', () => {
  it('leaves the meeting, its pending deliveries abandoned, while the others go on', async () => {
    const { messageId } = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'meeting', meetingId }, payload: 'Agenda', idempotencyKey: newKey(), model: SESSION_MODEL }));

    await retired(product);

    expect([presentShips(), core.state.deliveries.filter((delivery) => delivery.messageId === messageId).map(({ recipient, state }) => ({ recipient, state }))]).toEqual([
      [chief.shipId, marketing.shipId, design.shipId],
      [
        { recipient: { kind: 'ship', shipId: marketing.shipId }, state: 'pending' },
        { recipient: { kind: 'ship', shipId: product.shipId }, state: 'abandoned' },
        { recipient: { kind: 'ship', shipId: design.shipId }, state: 'pending' },
      ],
    ]);
  });

  it('has its mic request removed, and the mic it held freed, first in line handing it on', async () => {
    unwrap(await messaging.changeMic(chief, { meetingId, change: { kind: 'setPattern', pattern: 'fifo' } }));
    for (const ship of [product, marketing, design]) {
      unwrap(await messaging.changeMic(ship, { meetingId, change: { kind: 'request' } }));
    }

    await retired(marketing);
    await retired(product);

    expect([theMeeting()?.micHolderShipId, theMeeting()?.micRequests]).toEqual([design.shipId, []]);
  });

  it('writes ParticipantLeft for it, caused by the actor that retired it', async () => {
    core.state.events.length = 0;

    await retired(product);

    expect(core.state.events.filter(({ type }) => type === 'ParticipantLeft').map(({ shipId, actor, details }) => ({ shipId, actor, details }))).toEqual([
      { shipId: product.shipId, actor: { kind: 'ship', shipId: argo.shipId }, details: { meetingId } },
    ]);
  });
});

describe('a retired moderator (M17)', () => {
  it('gives its moderatorship, and so the mic, to the owner', async () => {
    unwrap(await messaging.changeMeeting(chief, { meetingId, change: { kind: 'nameModerator', shipId: design.shipId } }));
    unwrap(await messaging.changeMic(design, { meetingId, change: { kind: 'give', shipId: product.shipId } }));

    await retired(design);
    unwrap(await messaging.changeMic(chief, { meetingId, change: { kind: 'take' } }));

    expect([theMeeting()?.moderatorShipId, theMeeting()?.micHolderShipId]).toEqual([chief.shipId, null]);
  });
});

describe('a retired owner (M15)', () => {
  it('ends the meeting, every present participant told by a message from it, stating no model', async () => {
    unwrap(await messaging.changeMeeting(marketing, { meetingId, change: { kind: 'leave' } }));
    core.state.notices.length = 0;

    await retired(chief);

    expect([
      theMeeting()?.endedAt,
      core.state.messages.filter(({ contentType }) => contentType === MEETING_ENDED_CONTENT_TYPE).map(({ senderShipId, selector, model }) => ({ senderShipId, selector, model })),
      core.state.events.filter(({ type }) => type === 'MeetingEnded').map(({ shipId, actor }) => ({ shipId, actor })),
    ]).toEqual([
      core.clock.now(),
      [product, design].map(({ shipId }) => ({ senderShipId: chief.shipId, selector: { kind: 'ship', shipId }, model: null })),
      [{ shipId: chief.shipId, actor: { kind: 'ship', shipId: argo.shipId } }],
    ]);
  });
});
