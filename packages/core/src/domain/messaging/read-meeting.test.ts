import type { MeetingId, MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * Reading a meeting (decision 0061, M12 and M14): chief opens a meeting with
 * marketing and product; engineering takes no part.
 */
let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let chief: ShipCaller;
let marketing: ShipCaller;
let product: ShipCaller;
let engineering: ShipCaller;
let meetingId: MeetingId;

const OPENED_AT = '2026-10-24T09:00:00.000Z';

async function contributed(by: ShipCaller, payload: string): Promise<MessageId> {
  core.clock.advance(1_000);
  return unwrap(await messaging.sendMessage(by, { selector: { kind: 'meeting', meetingId }, payload, idempotencyKey: newKey(), model: SESSION_MODEL })).messageId;
}

beforeEach(async () => {
  core = createInMemoryCore(OPENED_AT);
  const fleet = await initialiseFleet(core);
  const argo = operatorCaller(fleet);
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

    expect({ ...read, participants: undefined, contributions: undefined }).toEqual({
      meetingId,
      title: 'Launch plan',
      owner: { id: chief.shipId, name: 'chief' },
      moderator: { id: chief.shipId, name: 'chief' },
      openedAt: new Date(OPENED_AT),
      endedAt: null,
      participants: undefined,
      contributions: undefined,
    });
  });

  it('shows each participant with its name, kind and status, crewed or awaiting crew: a ship that is not there is a choice (M14)', async () => {
    crewAboard(core, marketing);

    const read = unwrap(await messaging.readMeeting(chief, { meetingId, limit: 20 }));

    expect(read.participants).toEqual([
      { id: chief.shipId, name: 'chief', kind: 'agent', status: 'awaitingCrew' },
      { id: marketing.shipId, name: 'marketing', kind: 'agent', status: 'crewed' },
      { id: product.shipId, name: 'product', kind: 'agent', status: 'awaitingCrew' },
    ]);
  });

  it('shows what was said so far, newest first, with its sender, payload, content type, model and time, and no notice (M12)', async () => {
    const first = await contributed(chief, 'Agenda: the launch');
    const second = await contributed(product, 'Friday works');

    const read = unwrap(await messaging.readMeeting(marketing, { meetingId, limit: 20 }));

    expect(read.contributions).toEqual({
      items: [
        { messageId: second, sender: { id: product.shipId, name: 'product' }, payload: 'Friday works', contentType: 'text/plain', model: SESSION_MODEL, sentAt: new Date('2026-10-24T09:00:02.000Z') },
        { messageId: first, sender: { id: chief.shipId, name: 'chief' }, payload: 'Agenda: the launch', contentType: 'text/plain', model: SESSION_MODEL, sentAt: new Date('2026-10-24T09:00:01.000Z') },
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

  it('refuses a ship that is no participant, as it refuses a meeting that does not exist', async () => {
    const unknown = core.ids('meeting');

    expect([refusalOf(await messaging.readMeeting(engineering, { meetingId, limit: 20 })), refusalOf(await messaging.readMeeting(chief, { meetingId: unknown, limit: 20 }))]).toEqual([
      { kind: 'MEETING_NOT_FOUND', message: `Meeting ${meetingId} does not exist or you are not one of its participants` },
      { kind: 'MEETING_NOT_FOUND', message: `Meeting ${unknown} does not exist or you are not one of its participants` },
    ]);
  });
});
