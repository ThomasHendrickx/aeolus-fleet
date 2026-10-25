import { MEETING_ADDED_CONTENT_TYPE, meetingAddedSchema, type FleetId, type LabelValueId, type MeetingId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL, withInstallationSettings } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusedShip } from '../../../test/support/refused-sender.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MeetingToOpen } from './open-meeting.js';

/**
 * Opening a meeting (decision 0061): chief, holding meetings:open, invites
 * the heads. Under the rules, chief (role chief) reaches every head (role
 * head), and no head reaches another; vault carries no role, so chief does not
 * reach it.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let chief: ShipCaller;
let marketing: ShipCaller;
let product: ShipCaller;
let engineering: ShipCaller;
let vault: ShipCaller;

const NOT_REACHABLE = { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' };

function value(key: string, text: string): LabelValueId {
  return valueIdOf(core, { key, value: text });
}

function aMeeting(overrides: Partial<MeetingToOpen> = {}): MeetingToOpen {
  return { ships: [{ shipId: marketing.shipId }, { name: 'product' }], idempotencyKey: newKey(), model: SESSION_MODEL, ...overrides };
}

async function opened(input: MeetingToOpen = aMeeting()): Promise<MeetingId> {
  return unwrap(await messaging.openMeeting(chief, input)).meetingId;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-24T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chief-of-staff', scopes: ['meetings:open'] });
  marketing = await shipWithScopes({ registry, argo }, { name: 'marketing', type: 'head', scopes: [] });
  product = await shipWithScopes({ registry, argo }, { name: 'product', type: 'head', scopes: [] });
  engineering = await shipWithScopes({ registry, argo }, { name: 'engineering', type: 'head', scopes: [] });
  vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'keeper', scopes: [] });
  const networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
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
  core.clock.advance(60_000);
  core.state.events.length = 0;
  core.state.notices.length = 0;
});

describe('opening a meeting', () => {
  it('makes the opener its owner and moderator, a participant beside the ships it invited by id and by name', async () => {
    const meetingId = await opened();

    expect(core.state.meetings).toEqual([
      expect.objectContaining({
        id: meetingId,
        fleetId,
        ownerShipId: chief.shipId,
        moderatorShipId: chief.shipId,
        openedAt: new Date('2026-10-24T09:01:00.000Z'),
        endedAt: null,
        participants: [
          { shipId: chief.shipId, joinedAt: new Date('2026-10-24T09:01:00.000Z'), leftAt: null, isRevoked: false },
          { shipId: marketing.shipId, joinedAt: new Date('2026-10-24T09:01:00.000Z'), leftAt: null, isRevoked: false },
          { shipId: product.shipId, joinedAt: new Date('2026-10-24T09:01:00.000Z'), leftAt: null, isRevoked: false },
        ],
      }),
    ]);
  });

  it('gives the meeting an mtg_ id', async () => {
    await expect(opened()).resolves.toMatch(/^mtg_/);
  });

  it('invites the ships a label selection resolves to, every value held, and none missing one', async () => {
    unwrap(await registry.defineLabel(argo, { key: 'weekly', values: ['yes'] }));
    unwrap(await registry.assignLabel(argo, { shipId: engineering.shipId, valueId: value('weekly', 'yes') }));
    unwrap(await registry.assignLabel(argo, { shipId: vault.shipId, valueId: value('weekly', 'yes') }));

    await opened(aMeeting({ ships: [], valueIds: [value('role', 'head'), value('weekly', 'yes')] }));

    expect(core.state.meetings[0]?.participants.map(({ shipId }) => shipId)).toEqual([chief.shipId, engineering.shipId]);
  });

  it('folds a ship named twice, and the opener named again, into one participant each', async () => {
    await opened(aMeeting({ ships: [{ shipId: marketing.shipId }, { name: 'marketing' }, { shipId: chief.shipId }], valueIds: [value('role', 'head')] }));

    expect(core.state.meetings[0]?.participants.map(({ shipId }) => shipId)).toEqual([chief.shipId, marketing.shipId, product.shipId, engineering.shipId]);
  });

  it('writes MeetingOpened, then ParticipantAdded for each participant, the opener first, caused by the opener', async () => {
    const meetingId = await opened();

    const meetingEvents = core.state.events.filter((event) => event.type === 'MeetingOpened' || event.type === 'ParticipantAdded');
    expect(meetingEvents.map(({ type, shipId, actor, details }) => ({ type, shipId, actor, details }))).toEqual([
      { type: 'MeetingOpened', shipId: chief.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId, participants: 3 } },
      { type: 'ParticipantAdded', shipId: chief.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId } },
      { type: 'ParticipantAdded', shipId: marketing.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId } },
      { type: 'ParticipantAdded', shipId: product.shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId } },
    ]);
  });
});

describe('the added notice', () => {
  it('tells each participant but the owner by a message from the owner, with the meeting on its envelope', async () => {
    const meetingId = await opened();

    expect(core.state.messages.map(({ senderShipId, selector, contentType, model, meetingId: of }) => ({ senderShipId, selector, contentType, model, meetingId: of }))).toEqual([
      { senderShipId: chief.shipId, selector: { kind: 'ship', shipId: marketing.shipId }, contentType: MEETING_ADDED_CONTENT_TYPE, model: SESSION_MODEL, meetingId },
      { senderShipId: chief.shipId, selector: { kind: 'ship', shipId: product.shipId }, contentType: MEETING_ADDED_CONTENT_TYPE, model: SESSION_MODEL, meetingId },
    ]);
    expect(core.state.deliveries.map(({ recipient, state }) => ({ recipient, state }))).toEqual([
      { recipient: { kind: 'ship', shipId: marketing.shipId }, state: 'pending' },
      { recipient: { kind: 'ship', shipId: product.shipId }, state: 'pending' },
    ]);
  });

  it('carries the meeting, its title, its owner, its moderator and its participants by id and name', async () => {
    const meetingId = await opened(aMeeting({ title: 'Launch plan' }));

    const chiefParty = { id: chief.shipId, name: 'chief' };
    expect(meetingAddedSchema.parse(JSON.parse(core.state.messages[0]?.payload ?? ''))).toEqual({
      meetingId,
      title: 'Launch plan',
      owner: chiefParty,
      moderator: chiefParty,
      participants: [chiefParty, { id: marketing.shipId, name: 'marketing' }, { id: product.shipId, name: 'product' }],
    });
  });

  it('carries a null title for a meeting opened without one', async () => {
    await opened();

    expect(meetingAddedSchema.parse(JSON.parse(core.state.messages[0]?.payload ?? '')).title).toBeNull();
  });

  it('writes MessageAccepted for each notice and wakes each participant told', async () => {
    await opened();

    expect(core.state.events.filter((event) => event.type === 'MessageAccepted').map(({ shipId }) => shipId)).toEqual([marketing.shipId, product.shipId]);
    expect(core.state.notices.map(({ recipient }) => recipient)).toEqual([
      { kind: 'ship', shipId: marketing.shipId },
      { kind: 'ship', shipId: product.shipId },
    ]);
  });

  it('needs the model of an agent opener, as a send does, and stores nothing without it', async () => {
    const withoutModel: MeetingToOpen = { ...aMeeting(), model: undefined };

    expect(refusalOf(await messaging.openMeeting(chief, withoutModel)).kind).toBe('MODEL_REQUIRED');
    expect([core.state.meetings, core.state.messages, core.state.events]).toEqual([[], [], []]);
  });
});

describe('a repeat of an open', () => {
  it('answers the same meeting for the same request with the same key, and stores nothing new', async () => {
    const input = aMeeting();
    const meetingId = await opened(input);

    await expect(opened(input)).resolves.toBe(meetingId);
    expect([core.state.meetings.length, core.state.messages.length]).toEqual([1, 2]);
  });

  it('refuses the same key with another request', async () => {
    const input = aMeeting();
    await opened(input);

    expect(refusalOf(await messaging.openMeeting(chief, { ...input, ships: [{ shipId: engineering.shipId }] }))).toEqual({
      kind: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This idempotency key was already used for another meeting: open a new meeting with a new key',
    });
  });
});

describe('an open the fleet refuses', () => {
  it('refuses an invitee the owner does not reach, recording the refusal and storing nothing else', async () => {
    const refused = await messaging.openMeeting(chief, aMeeting({ ships: [{ shipId: marketing.shipId }, { shipId: vault.shipId }] }));

    expect(refusalOf(refused)).toEqual(NOT_REACHABLE);
    expect(core.state.reachRefusals.map((refusal) => [refusedShip(refusal.sender).id, refusal.recipient.kind === 'ship' ? refusal.recipient.ship.id : null])).toEqual([
      [chief.shipId, vault.shipId],
    ]);
    expect([core.state.meetings, core.state.messages, core.state.deliveries, core.state.events, core.state.notices]).toEqual([[], [], [], [], []]);
  });

  it('refuses an open whose added notices would pass the daily message limit, storing nothing', async () => {
    withInstallationSettings(core, { defaultDailyMessageLimit: 1 });

    const refused = await messaging.openMeeting(chief, aMeeting({ ships: [{ shipId: marketing.shipId }, { shipId: product.shipId }] }));

    expect(refusalOf(refused).kind).toBe('MESSAGE_LIMIT_REACHED');
    expect([core.state.meetings, core.state.messages, core.state.deliveries, core.state.events, core.state.notices]).toEqual([[], [], [], [], []]);
  });

  it('opens when the added notices fit the daily message limit exactly', async () => {
    withInstallationSettings(core, { defaultDailyMessageLimit: 2 });

    await expect(messaging.openMeeting(chief, aMeeting({ ships: [{ shipId: marketing.shipId }, { shipId: product.shipId }] }))).resolves.toMatchObject({ isOk: true });
    expect(core.state.messages).toHaveLength(2);
  });

  it('refuses a ship that does not exist', async () => {
    const refused = await messaging.openMeeting(chief, aMeeting({ ships: [{ name: 'nobody' }] }));

    expect(refusalOf(refused)).toEqual({ kind: 'UNRESOLVABLE_SELECTOR', message: 'No active ship is named nobody' });
  });

  it('refuses a retired ship', async () => {
    unwrap(await registry.retireShip(argo, { shipId: product.shipId }));

    expect(refusalOf(await messaging.openMeeting(chief, aMeeting())).kind).toBe('UNRESOLVABLE_SELECTOR');
    expect(core.state.meetings).toEqual([]);
  });

  it('refuses a meeting with no ship but the opener', async () => {
    const refused = await messaging.openMeeting(chief, aMeeting({ ships: [{ shipId: chief.shipId }], valueIds: [value('role', 'chief')] }));

    expect(refusalOf(refused)).toEqual({ kind: 'MEETING_WITHOUT_INVITEES', message: 'A meeting needs at least one ship besides its opener: invite ships by id, by name or by label' });
  });

  it('refuses the viewer by name, as it receives nothing', async () => {
    const refused = await messaging.openMeeting(chief, aMeeting({ ships: [{ name: 'viewer' }] }));

    expect(refusalOf(refused).kind).toBe('UNRESOLVABLE_SELECTOR');
  });
});
