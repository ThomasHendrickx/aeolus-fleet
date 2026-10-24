import { MEETING_ENDED_CONTENT_TYPE, meetingEndedSchema, type LabelValueId, type MeetingId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusedShip } from '../../../test/support/refused-sender.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MeetingChange } from './meeting-life.js';
import type { MicChange } from './mic.js';

/**
 * A meeting's life (decision 0061, M2, M3, M5, M13, M15): chief opens a
 * meeting with marketing, product and design, owning and moderating it. Under
 * the rules chief reaches the heads, and no head reaches another.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let networking: ShipCaller;
let chief: ShipCaller;
let marketing: ShipCaller;
let product: ShipCaller;
let design: ShipCaller;
let engineering: ShipCaller;
let meetingId: MeetingId;

function value(key: string, text: string): LabelValueId {
  return valueIdOf(core, { key, value: text });
}

async function changed(by: ShipCaller, change: MeetingChange) {
  core.clock.advance(1_000);
  return messaging.changeMeeting(by, { meetingId, change });
}

async function done(by: ShipCaller, change: MeetingChange): Promise<void> {
  unwrap(await changed(by, change));
}

async function micDone(by: ShipCaller, change: MicChange): Promise<void> {
  core.clock.advance(1_000);
  unwrap(await messaging.changeMic(by, { meetingId, change }));
}

function theMeeting() {
  return core.state.meetings.find(({ id }) => id === meetingId);
}

/** The ships a contribution by the ship reaches now, one delivery each. */
async function reachedBy(ship: ShipCaller): Promise<ShipId[]> {
  const { messageId } = unwrap(await messaging.sendMessage(ship, { selector: { kind: 'meeting', meetingId }, payload: 'Status?', idempotencyKey: newKey(), model: SESSION_MODEL }));
  return core.state.deliveries.filter((delivery) => delivery.messageId === messageId).flatMap(({ recipient }) => (recipient.kind === 'ship' ? [recipient.shipId] : []));
}

function stateOf(ship: ShipCaller) {
  const participant = theMeeting()?.participants.find(({ shipId }) => shipId === ship.shipId);
  if (participant === undefined) {
    return 'never';
  }
  if (participant.isRevoked) {
    return 'revoked';
  }
  return participant.leftAt === null ? 'present' : 'left';
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-24T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  const argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: ['meetings:open'] });
  marketing = await shipWithScopes({ registry, argo }, { name: 'marketing', type: 'head', scopes: [] });
  product = await shipWithScopes({ registry, argo }, { name: 'product', type: 'head', scopes: [] });
  design = await shipWithScopes({ registry, argo }, { name: 'design', type: 'head', scopes: [] });
  engineering = await shipWithScopes({ registry, argo }, { name: 'engineering', type: 'head', scopes: [] });
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  unwrap(await registry.defineLabel(argo, { key: 'role', values: ['chief', 'head'] }));
  for (const [ship, role] of [
    [chief, 'chief'],
    [marketing, 'head'],
    [product, 'head'],
    [design, 'head'],
    [engineering, 'head'],
  ] as const) {
    unwrap(await registry.assignLabel(argo, { shipId: ship.shipId, valueId: value('role', role) }));
  }
  await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [value('role', 'chief')], to: [value('role', 'head')] }] });
  ({ meetingId } = unwrap(
    await messaging.openMeeting(chief, { ships: [{ shipId: marketing.shipId }, { shipId: product.shipId }, { shipId: design.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL }),
  ));
  core.state.events.length = 0;
  core.state.notices.length = 0;
});

describe('leaving a meeting (M13)', () => {
  it('takes the participant out: contributions no longer reach it, and it keeps its right', async () => {
    await done(product, { kind: 'leave' });

    expect([stateOf(product), await reachedBy(chief)]).toEqual(['left', [marketing.shipId, design.shipId]]);
  });

  it('is refused for the owner, which transfers the meeting first', async () => {
    expect(refusalOf(await changed(chief, { kind: 'leave' }))).toEqual({
      kind: 'OWNER_CANNOT_LEAVE',
      message: `You own meeting ${meetingId}: transfer it to another participant first`,
    });
  });

  it('gives the moderatorship of a moderator that leaves to the owner', async () => {
    await done(chief, { kind: 'nameModerator', shipId: design.shipId });

    await done(design, { kind: 'leave' });

    expect([theMeeting()?.moderatorShipId, stateOf(design)]).toEqual([chief.shipId, 'left']);
  });

  it('frees the mic of a holder that leaves, first in line handing it on, and takes a leaving ship off the list', async () => {
    await micDone(chief, { kind: 'setPattern', pattern: 'fifo' });
    await micDone(product, { kind: 'request' });
    await micDone(marketing, { kind: 'request' });
    await micDone(design, { kind: 'request' });

    await done(marketing, { kind: 'leave' });
    await done(product, { kind: 'leave' });

    expect([theMeeting()?.micHolderShipId, theMeeting()?.micRequests]).toEqual([design.shipId, []]);
  });

  it('stops the ship contributing until it rejoins', async () => {
    await done(product, { kind: 'leave' });

    expect(refusalOf(await messaging.sendMessage(product, { selector: { kind: 'meeting', meetingId }, payload: 'Me again', idempotencyKey: newKey(), model: SESSION_MODEL }))).toEqual({
      kind: 'PARTICIPANT_LEFT',
      message: `You left meeting ${meetingId}: rejoin it first`,
    });
  });

  it('is refused for a ship that left already', async () => {
    await done(product, { kind: 'leave' });

    expect(refusalOf(await changed(product, { kind: 'leave' }))).toEqual({ kind: 'PARTICIPANT_LEFT', message: `You left meeting ${meetingId}: rejoin it first` });
  });
});

describe('rejoining a meeting (M5, M12, M13)', () => {
  it('brings a ship that left back by itself: contributions reach it from then on', async () => {
    await done(product, { kind: 'leave' });
    const whileAway = await reachedBy(chief);

    await done(product, { kind: 'rejoin' });

    expect([stateOf(product), whileAway, await reachedBy(chief)]).toEqual(['present', [marketing.shipId, design.shipId], [marketing.shipId, product.shipId, design.shipId]]);
  });

  it("is checked on the owner's reach again: refused once the owner no longer reaches it, the refusal recorded", async () => {
    await done(product, { kind: 'leave' });
    await applyNetworkRules(registry, { by: networking, rules: [] });
    core.state.reachRefusals.length = 0;

    expect([refusalOf(await changed(product, { kind: 'rejoin' })), stateOf(product), core.state.reachRefusals.map((refusal) => ({ fromShipId: refusedShip(refusal.sender).id, toShipId: refusal.recipient.kind === 'ship' ? refusal.recipient.ship.id : null }))]).toEqual([
      { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' },
      'left',
      [{ fromShipId: chief.shipId, toShipId: product.shipId }],
    ]);
  });

  it('is refused for a ship whose right the owner revoked, and while present', async () => {
    await done(chief, { kind: 'revoke', shipId: product.shipId });

    expect([refusalOf(await changed(product, { kind: 'rejoin' })), refusalOf(await changed(marketing, { kind: 'rejoin' }))]).toEqual([
      { kind: 'PARTICIPANT_REVOKED', message: `The owner of meeting ${meetingId} revoked your right to it: only the owner adds you again` },
      { kind: 'ALREADY_PRESENT', message: `You take part in meeting ${meetingId} already` },
    ]);
  });

  it('is refused for a ship that never took part, as for a meeting that does not exist', async () => {
    expect(refusalOf(await changed(engineering, { kind: 'rejoin' }))).toEqual({ kind: 'MEETING_NOT_FOUND', message: `Meeting ${meetingId} does not exist or you are not one of its participants` });
  });
});

describe('revoking a ship (M13)', () => {
  it('takes it out for good: contributions no longer reach it, and it cannot contribute', async () => {
    await done(chief, { kind: 'revoke', shipId: product.shipId });

    expect([stateOf(product), await reachedBy(chief), refusalOf(await messaging.sendMessage(product, { selector: { kind: 'meeting', meetingId }, payload: 'Still here', idempotencyKey: newKey(), model: SESSION_MODEL }))]).toEqual([
      'revoked',
      [marketing.shipId, design.shipId],
      { kind: 'PARTICIPANT_REVOKED', message: `The owner of meeting ${meetingId} revoked your right to it: only the owner adds you again` },
    ]);
  });

  it('is for the owner only, and never of the owner itself', async () => {
    expect([refusalOf(await changed(marketing, { kind: 'revoke', shipId: product.shipId })), refusalOf(await changed(chief, { kind: 'revoke', shipId: chief.shipId }))]).toEqual([
      { kind: 'NOT_OWNER', message: `Only the owner of meeting ${meetingId} adds and revokes ships, transfers it and names its moderator` },
      { kind: 'OWNER_CANNOT_LEAVE', message: `You own meeting ${meetingId}: transfer it to another participant first` },
    ]);
  });

  it('gives the moderatorship of a revoked moderator to the owner, and frees the mic it held', async () => {
    await micDone(chief, { kind: 'give', shipId: product.shipId });
    await done(chief, { kind: 'nameModerator', shipId: design.shipId });

    await done(chief, { kind: 'revoke', shipId: product.shipId });
    await done(chief, { kind: 'revoke', shipId: design.shipId });

    expect([theMeeting()?.moderatorShipId, theMeeting()?.micHolderShipId]).toEqual([chief.shipId, null]);
  });
});

describe('transferring a meeting (M2)', () => {
  it('makes a present participant its owner, who may then revoke, while the former owner may leave, its moderatorship going to the new owner', async () => {
    await done(chief, { kind: 'transfer', shipId: marketing.shipId });

    await done(marketing, { kind: 'revoke', shipId: product.shipId });
    await done(chief, { kind: 'leave' });

    expect([theMeeting()?.ownerShipId, theMeeting()?.moderatorShipId, stateOf(product), stateOf(chief)]).toEqual([marketing.shipId, marketing.shipId, 'revoked', 'left']);
  });

  it("checks a rejoin on the new owner's reach from then on (M5)", async () => {
    await done(chief, { kind: 'transfer', shipId: marketing.shipId });
    await done(product, { kind: 'leave' });

    // marketing, a head, reaches no other head.
    expect(refusalOf(await changed(product, { kind: 'rejoin' })).kind).toBe('NOT_REACHABLE');
  });

  it('is for the owner only, to a present participant', async () => {
    await done(product, { kind: 'leave' });

    expect([refusalOf(await changed(marketing, { kind: 'transfer', shipId: marketing.shipId })), refusalOf(await changed(chief, { kind: 'transfer', shipId: product.shipId }))]).toEqual([
      { kind: 'NOT_OWNER', message: `Only the owner of meeting ${meetingId} adds and revokes ships, transfers it and names its moderator` },
      { kind: 'PARTICIPANT_NOT_FOUND', message: `Ship ${product.shipId} is not one of the participants of meeting ${meetingId}` },
    ]);
  });
});

describe('naming the moderator (M3)', () => {
  it('makes a present participant the moderator, who gives the mic from then on', async () => {
    await done(chief, { kind: 'nameModerator', shipId: design.shipId });

    await micDone(design, { kind: 'give', shipId: product.shipId });

    expect([theMeeting()?.moderatorShipId, theMeeting()?.micHolderShipId]).toEqual([design.shipId, product.shipId]);
  });

  it('frees the mic the new moderator held, and takes its request off the list: the moderator needs none', async () => {
    await micDone(product, { kind: 'request' });
    await micDone(chief, { kind: 'give', shipId: design.shipId });

    await done(chief, { kind: 'nameModerator', shipId: design.shipId });
    const afterDesign = theMeeting()?.micHolderShipId;
    await done(chief, { kind: 'nameModerator', shipId: product.shipId });

    expect([afterDesign, theMeeting()?.micRequests]).toEqual([null, []]);
  });

  it('is for the owner only', async () => {
    expect(refusalOf(await changed(marketing, { kind: 'nameModerator', shipId: marketing.shipId })).kind).toBe('NOT_OWNER');
  });
});

describe('ending a meeting (M15)', () => {
  /** The ended notices stored: from whom, to whom, about which meeting, stating which model. */
  function endedNotices() {
    return core.state.messages
      .filter(({ contentType }) => contentType === MEETING_ENDED_CONTENT_TYPE)
      .map(({ senderShipId, selector, meetingId: of, model, payload }) => ({ senderShipId, selector, meetingId: of, model, payload: meetingEndedSchema.parse(JSON.parse(payload)) }));
  }

  it('by the owner tells every other present participant, by a message from the owner stating no model, and wakes each', async () => {
    await done(product, { kind: 'leave' });

    await done(chief, { kind: 'end' });

    expect([theMeeting()?.endedAt, endedNotices()]).toEqual([
      core.clock.now(),
      [marketing, design].map(({ shipId }) => ({ senderShipId: chief.shipId, selector: { kind: 'ship', shipId }, meetingId, model: null, payload: { meetingId } })),
    ]);
    expect(core.state.notices.map(({ recipient }) => recipient)).toEqual([marketing, design].map(({ shipId }) => ({ kind: 'ship', shipId })));
  });

  it('by the moderator too, the owner told as any participant', async () => {
    await done(chief, { kind: 'nameModerator', shipId: design.shipId });

    await done(design, { kind: 'end' });

    expect(endedNotices().map(({ senderShipId, selector }) => ({ senderShipId, selector }))).toEqual(
      [chief, marketing, product].map(({ shipId }) => ({ senderShipId: design.shipId, selector: { kind: 'ship', shipId } })),
    );
  });

  it('is refused for a participant that neither owns nor moderates it', async () => {
    expect(refusalOf(await changed(product, { kind: 'end' }))).toEqual({ kind: 'NOT_OWNER_OR_MODERATOR', message: `Only the owner or the moderator of meeting ${meetingId} ends it` });
  });

  it('takes no more contributions, participants, changes or mic changes', async () => {
    await done(chief, { kind: 'end' });

    expect([
      refusalOf(await messaging.sendMessage(chief, { selector: { kind: 'meeting', meetingId }, payload: 'One more thing', idempotencyKey: newKey(), model: SESSION_MODEL })).kind,
      refusalOf(await messaging.addToMeeting(chief, { meetingId, ships: [{ shipId: engineering.shipId }], model: SESSION_MODEL })).kind,
      refusalOf(await changed(product, { kind: 'leave' })),
      refusalOf(await messaging.changeMic(product, { meetingId, change: { kind: 'request' } })).kind,
    ]).toEqual(['MEETING_ENDED', 'MEETING_ENDED', { kind: 'MEETING_ENDED', message: `Meeting ${meetingId} ended: it no longer changes` }, 'MEETING_ENDED']);
  });

  it('still delivers the deliveries pending when it ended, and lets every former participant read it', async () => {
    const said: MessageId = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'meeting', meetingId }, payload: 'Wrap up', idempotencyKey: newKey(), model: SESSION_MODEL })).messageId;
    await done(design, { kind: 'leave' });
    await done(chief, { kind: 'end' });

    const received = unwrap(await messaging.receiveDeliveries(crewAboard(core, product), { max: 10 })).deliveries.filter(({ messageId }) => messageId === said);
    const readByLeft = unwrap(await messaging.readMeeting(design, { meetingId, limit: 20 }));

    expect([received.length, readByLeft.contributions.items.map(({ messageId }) => messageId)]).toEqual([1, [said]]);
  });
});

describe("the events of a meeting's life", () => {
  it('record each change on the ship it concerns, caused by the ship that made it', async () => {
    await done(product, { kind: 'leave' });
    await done(product, { kind: 'rejoin' });
    await done(chief, { kind: 'revoke', shipId: design.shipId });
    await done(chief, { kind: 'nameModerator', shipId: marketing.shipId });
    await done(chief, { kind: 'transfer', shipId: product.shipId });
    await done(marketing, { kind: 'end' });

    const lifeEvents = ['ParticipantLeft', 'ParticipantRejoined', 'ParticipantRevoked', 'ModeratorNamed', 'OwnershipTransferred', 'MeetingEnded'];
    expect(core.state.events.filter(({ type }) => lifeEvents.includes(type)).map(({ type, shipId, actor, details }) => ({ type, shipId, actor, details }))).toEqual([
      { type: 'ParticipantLeft', shipId: product.shipId, actor: { kind: 'ship', shipId: product.shipId }, details: { meetingId } },
      { type: 'ParticipantRejoined', shipId: product.shipId, actor: { kind: 'ship', shipId: product.shipId }, details: { meetingId } },
      { type: 'ParticipantRevoked', shipId: design.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId } },
      { type: 'ModeratorNamed', shipId: marketing.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId } },
      { type: 'OwnershipTransferred', shipId: product.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId } },
      { type: 'MeetingEnded', shipId: marketing.shipId, actor: { kind: 'ship', shipId: marketing.shipId }, details: { meetingId } },
    ]);
  });

  it('record nothing and send nothing for a refused change', async () => {
    const before = core.state.messages.length;

    await changed(product, { kind: 'end' });

    expect([core.state.events, core.state.messages.length, core.state.notices]).toEqual([[], before, []]);
  });
});
