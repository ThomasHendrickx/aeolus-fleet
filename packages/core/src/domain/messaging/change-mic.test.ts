import { MEETING_MIC_CONTENT_TYPE, meetingMicSchema, type MeetingId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MicChange } from './mic.js';

/**
 * The mic of a meeting (decision 0061, M7 to M11): chief opens a meeting with
 * marketing, product and design, and moderates it; engineering takes no part.
 */
let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let chief: ShipCaller;
let marketing: ShipCaller;
let product: ShipCaller;
let design: ShipCaller;
let engineering: ShipCaller;
let meetingId: MeetingId;

async function changed(by: ShipCaller, change: MicChange) {
  core.clock.advance(1_000);
  return messaging.changeMic(by, { meetingId, change });
}

async function done(by: ShipCaller, change: MicChange): Promise<void> {
  unwrap(await changed(by, change));
}

function theMeeting() {
  const meeting = core.state.meetings.find(({ id }) => id === meetingId);
  if (!meeting) {
    throw new Error('the meeting is gone');
  }
  return meeting;
}

/** Who holds the mic, and who waits for it, in order. */
function micState(): { holder: ShipId | null; waiting: ShipId[] } {
  const { micHolderShipId, micRequests } = theMeeting();
  return { holder: micHolderShipId, waiting: micRequests.map(({ shipId }) => shipId) };
}

/** The mic notices stored so far: from whom, to whom, about which meeting. */
function micNotices() {
  return core.state.messages
    .filter(({ contentType }) => contentType === MEETING_MIC_CONTENT_TYPE)
    .map(({ senderShipId, selector, meetingId: of, model, payload }) => ({ senderShipId, selector, meetingId: of, model, payload: meetingMicSchema.parse(JSON.parse(payload)) }));
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-24T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  const argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: ['meetings:open'] });
  marketing = await shipWithScopes({ registry, argo }, { name: 'marketing', type: 'head', scopes: [] });
  product = await shipWithScopes({ registry, argo }, { name: 'product', type: 'head', scopes: [] });
  design = await shipWithScopes({ registry, argo }, { name: 'design', type: 'head', scopes: [] });
  engineering = await shipWithScopes({ registry, argo }, { name: 'engineering', type: 'head', scopes: [] });
  ({ meetingId } = unwrap(
    await messaging.openMeeting(chief, { ships: [{ shipId: marketing.shipId }, { shipId: product.shipId }, { shipId: design.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL }),
  ));
  core.state.events.length = 0;
  core.state.notices.length = 0;
});

describe('a meeting opens', () => {
  it('with the mic free, given by the moderator, and nobody waiting for it', () => {
    expect([theMeeting().micPattern, micState()]).toEqual(['moderator', { holder: null, waiting: [] }]);
  });
});

describe('a mic request (M8)', () => {
  it('puts the ship on the list with its time, a new request at the back', async () => {
    await done(product, { kind: 'request' });
    await done(marketing, { kind: 'request' });

    expect(theMeeting().micRequests).toEqual([
      { shipId: product.shipId, requestedAt: new Date('2026-10-24T09:00:01.000Z') },
      { shipId: marketing.shipId, requestedAt: new Date('2026-10-24T09:00:02.000Z') },
    ]);
  });

  it('is one per ship: a second request is refused, and so is one from the holder', async () => {
    await done(product, { kind: 'request' });
    await done(chief, { kind: 'give', shipId: marketing.shipId });

    expect([refusalOf(await changed(product, { kind: 'request' })), refusalOf(await changed(marketing, { kind: 'request' }))]).toEqual([
      { kind: 'MIC_ALREADY_REQUESTED', message: `You requested the mic of meeting ${meetingId} already: wait for it, or withdraw the request` },
      { kind: 'MIC_ALREADY_HELD', message: `You hold the mic of meeting ${meetingId} already: contribute, then release it` },
    ]);
  });

  it('is refused for the moderator, which always contributes (M7)', async () => {
    expect(refusalOf(await changed(chief, { kind: 'request' }))).toEqual({
      kind: 'MODERATOR_NEEDS_NO_MIC',
      message: `You moderate meeting ${meetingId}: the moderator always contributes and needs no mic`,
    });
  });

  it('is refused for a ship that is no participant, as for a meeting that does not exist, and for an ended meeting', async () => {
    const refusedStranger = refusalOf(await changed(engineering, { kind: 'request' }));
    theMeeting().endedAt = new Date('2026-10-24T09:30:00.000Z');

    expect([refusedStranger, refusalOf(await changed(product, { kind: 'request' }))]).toEqual([
      { kind: 'MEETING_NOT_FOUND', message: `Meeting ${meetingId} does not exist or you are not one of its participants` },
      { kind: 'MEETING_ENDED', message: `Meeting ${meetingId} ended: its mic no longer changes` },
    ]);
  });

  it('is withdrawn by its ship, which leaves the list, and a withdrawal without a request is refused', async () => {
    await done(product, { kind: 'request' });
    await done(marketing, { kind: 'request' });
    await done(product, { kind: 'withdraw' });

    expect([micState().waiting, refusalOf(await changed(product, { kind: 'withdraw' }))]).toEqual([
      [marketing.shipId],
      { kind: 'MIC_NOT_REQUESTED', message: `You have no mic request in meeting ${meetingId} to withdraw` },
    ]);
  });
});

describe('the moderator gives the mic (M9)', () => {
  it('to whom it likes, on the list or not, who leaves the list', async () => {
    await done(product, { kind: 'request' });
    await done(marketing, { kind: 'request' });

    await done(chief, { kind: 'give', shipId: marketing.shipId });

    expect(micState()).toEqual({ holder: marketing.shipId, waiting: [product.shipId] });
  });

  it('tells the new holder alone, by a message from the moderator stating no model, the meeting on its envelope, and wakes it (M11)', async () => {
    await done(chief, { kind: 'give', shipId: design.shipId });

    expect(micNotices()).toEqual([{ senderShipId: chief.shipId, selector: { kind: 'ship', shipId: design.shipId }, meetingId, model: null, payload: { meetingId } }]);
    expect(core.state.notices.map(({ recipient }) => recipient)).toEqual([{ kind: 'ship', shipId: design.shipId }]);
  });

  it('straight from its holder to another: the holder loses it', async () => {
    await done(chief, { kind: 'give', shipId: design.shipId });
    await done(chief, { kind: 'give', shipId: product.shipId });

    expect([micState().holder, micNotices().map(({ selector }) => selector)]).toEqual([
      product.shipId,
      [
        { kind: 'ship', shipId: design.shipId },
        { kind: 'ship', shipId: product.shipId },
      ],
    ]);
  });

  it('only: a participant that does not moderate gives, takes and sets nothing', async () => {
    const notModerator = { kind: 'NOT_MODERATOR', message: `Only the moderator of meeting ${meetingId} gives the mic, takes it back and sets how it passes` };

    expect([
      refusalOf(await changed(product, { kind: 'give', shipId: product.shipId })),
      refusalOf(await changed(product, { kind: 'take' })),
      refusalOf(await changed(product, { kind: 'setPattern', pattern: 'fifo' })),
    ]).toEqual([notModerator, notModerator, notModerator]);
  });

  it('to participants only, never to itself', async () => {
    expect([refusalOf(await changed(chief, { kind: 'give', shipId: engineering.shipId })), refusalOf(await changed(chief, { kind: 'give', shipId: chief.shipId }))]).toEqual([
      { kind: 'PARTICIPANT_NOT_FOUND', message: `Ship ${engineering.shipId} is not one of the participants of meeting ${meetingId}` },
      { kind: 'MODERATOR_NEEDS_NO_MIC', message: `You moderate meeting ${meetingId}: the moderator always contributes and needs no mic` },
    ]);
  });
});

describe('releasing the mic (M10)', () => {
  it('frees it: its holder says it no longer needs it', async () => {
    await done(chief, { kind: 'give', shipId: design.shipId });

    await done(design, { kind: 'release' });

    expect(micState()).toEqual({ holder: null, waiting: [] });
  });

  it('is refused for a ship that does not hold it', async () => {
    await done(chief, { kind: 'give', shipId: design.shipId });

    expect(refusalOf(await changed(product, { kind: 'release' }))).toEqual({ kind: 'MIC_NOT_HELD', message: `You do not hold the mic of meeting ${meetingId}` });
  });

  it('never happens by itself: a held mic stays held until the moderator takes it back', async () => {
    await done(chief, { kind: 'give', shipId: design.shipId });
    core.clock.advance(24 * 60 * 60 * 1_000);
    const heldADayLater = micState().holder;

    await done(chief, { kind: 'take' });

    expect([heldADayLater, micState().holder]).toEqual([design.shipId, null]);
  });

  it('taking back a free mic is refused', async () => {
    expect(refusalOf(await changed(chief, { kind: 'take' }))).toEqual({ kind: 'MIC_FREE', message: `Nobody holds the mic of meeting ${meetingId}: there is nothing to take back` });
  });
});

describe('first in line (M9)', () => {
  it('gives a free mic to the oldest request once the moderator sets it, telling that ship', async () => {
    await done(product, { kind: 'request' });
    await done(marketing, { kind: 'request' });

    await done(chief, { kind: 'setPattern', pattern: 'fifo' });

    expect([micState(), micNotices().map(({ selector }) => selector)]).toEqual([{ holder: product.shipId, waiting: [marketing.shipId] }, [{ kind: 'ship', shipId: product.shipId }]]);
  });

  it('gives a free mic at once to a ship that requests it', async () => {
    await done(chief, { kind: 'setPattern', pattern: 'fifo' });

    await done(design, { kind: 'request' });

    expect(micState()).toEqual({ holder: design.shipId, waiting: [] });
  });

  it('hands the mic on to the oldest request when it is released or taken back, from the moderator', async () => {
    await done(chief, { kind: 'setPattern', pattern: 'fifo' });
    await done(product, { kind: 'request' });
    await done(marketing, { kind: 'request' });
    await done(design, { kind: 'request' });

    await done(product, { kind: 'release' });
    const afterRelease = micState();
    await done(chief, { kind: 'take' });

    expect([afterRelease, micState(), micNotices().map(({ senderShipId }) => senderShipId)]).toEqual([
      { holder: marketing.shipId, waiting: [design.shipId] },
      { holder: design.shipId, waiting: [] },
      [chief.shipId, chief.shipId, chief.shipId],
    ]);
  });

  it('becomes a round robin when each ship requests again after speaking', async () => {
    await done(chief, { kind: 'setPattern', pattern: 'fifo' });
    for (const ship of [product, marketing, design]) {
      await done(ship, { kind: 'request' });
    }
    const spoke: ShipId[] = [];
    for (let turn = 0; turn < 6; turn += 1) {
      const holder = [product, marketing, design].find(({ shipId }) => shipId === micState().holder);
      if (!holder) {
        throw new Error('the mic is free');
      }
      unwrap(await messaging.sendMessage(holder, { selector: { kind: 'meeting', meetingId }, payload: `turn ${String(turn)}`, idempotencyKey: newKey(), model: SESSION_MODEL }));
      spoke.push(holder.shipId);
      await done(holder, { kind: 'release' });
      await done(holder, { kind: 'request' });
    }

    expect(spoke).toEqual([product, marketing, design, product, marketing, design].map(({ shipId }) => shipId));
  });

  it('leaves the holder as it is when the moderator sets its own pick again', async () => {
    await done(chief, { kind: 'setPattern', pattern: 'fifo' });
    await done(product, { kind: 'request' });
    await done(marketing, { kind: 'request' });

    await done(chief, { kind: 'setPattern', pattern: 'moderator' });
    await done(product, { kind: 'release' });

    expect([theMeeting().micPattern, micState()]).toEqual(['moderator', { holder: null, waiting: [marketing.shipId] }]);
  });
});

describe('the mic events', () => {
  it('record each change on the ship it concerns, caused by the ship that made it, a hand-on by the moderator', async () => {
    await done(product, { kind: 'request' });
    await done(marketing, { kind: 'request' });
    await done(marketing, { kind: 'withdraw' });
    await done(chief, { kind: 'give', shipId: product.shipId });
    await done(product, { kind: 'release' });
    await done(design, { kind: 'request' });
    await done(chief, { kind: 'setPattern', pattern: 'fifo' });
    await done(chief, { kind: 'take' });

    expect(core.state.events.filter(({ type }) => type.startsWith('Mic')).map(({ type, shipId, actor, details }) => ({ type, shipId, actor, details }))).toEqual([
      { type: 'MicRequested', shipId: product.shipId, actor: { kind: 'ship', shipId: product.shipId }, details: { meetingId } },
      { type: 'MicRequested', shipId: marketing.shipId, actor: { kind: 'ship', shipId: marketing.shipId }, details: { meetingId } },
      { type: 'MicRequestWithdrawn', shipId: marketing.shipId, actor: { kind: 'ship', shipId: marketing.shipId }, details: { meetingId } },
      { type: 'MicGiven', shipId: product.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId, pattern: 'moderator' } },
      { type: 'MicReleased', shipId: product.shipId, actor: { kind: 'ship', shipId: product.shipId }, details: { meetingId } },
      { type: 'MicRequested', shipId: design.shipId, actor: { kind: 'ship', shipId: design.shipId }, details: { meetingId } },
      { type: 'MicPatternSet', shipId: chief.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId, pattern: 'fifo' } },
      { type: 'MicGiven', shipId: design.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId, pattern: 'fifo' } },
      { type: 'MicTaken', shipId: design.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId } },
    ]);
  });

  it('record nothing and send nothing for a refused change', async () => {
    const before = core.state.messages.length;

    await changed(product, { kind: 'release' });

    expect([core.state.events, core.state.messages.length, core.state.notices]).toEqual([[], before, []]);
  });
});
