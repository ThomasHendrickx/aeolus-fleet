import { MEETING_ADDED_CONTENT_TYPE, meetingAddedSchema, type LabelValueId, type MeetingId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusedShip } from '../../../test/support/refused-sender.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { ShipsToAdd } from './add-to-meeting.js';

/**
 * Adding ships to a meeting later (decision 0061, M5, M6, M12): chief opens a
 * meeting with marketing and owns it. Under the rules chief reaches every
 * head, design and product among them, and not vault.
 */
let core: InMemoryCore;
let messaging: ReturnType<typeof messagingUseCases>;
let chief: ShipCaller;
let marketing: ShipCaller;
let product: ShipCaller;
let design: ShipCaller;
let vault: ShipCaller;
let meetingId: MeetingId;

function value(key: string, text: string): LabelValueId {
  return valueIdOf(core, { key, value: text });
}

function toAdd(overrides: Partial<ShipsToAdd> = {}): ShipsToAdd {
  return { meetingId, ships: [{ shipId: product.shipId }], model: SESSION_MODEL, ...overrides };
}

function participantsOf(): ShipId[] {
  return core.state.meetings.find(({ id }) => id === meetingId)?.participants.filter(({ leftAt }) => leftAt === null).map(({ shipId }) => shipId) ?? [];
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
  vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'vault', scopes: [] });
  const networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  unwrap(await registry.defineLabel(argo, { key: 'role', values: ['chief', 'head'] }));
  for (const [ship, role] of [
    [chief, 'chief'],
    [marketing, 'head'],
    [product, 'head'],
    [design, 'head'],
  ] as const) {
    unwrap(await registry.assignLabel(argo, { shipId: ship.shipId, valueId: value('role', role) }));
  }
  await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [value('role', 'chief')], to: [value('role', 'head')] }] });
  ({ meetingId } = unwrap(await messaging.openMeeting(chief, { ships: [{ shipId: marketing.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL, title: 'Launch' })));
  core.clock.advance(60_000);
  core.state.events.length = 0;
  core.state.notices.length = 0;
});

describe('adding ships to a meeting', () => {
  it('adds the ships named by id, by name and by a label selection, each once, after those there already', async () => {
    unwrap(await messaging.addToMeeting(chief, toAdd({ ships: [{ name: 'design' }], valueIds: [value('role', 'head')] })));

    expect(participantsOf()).toEqual([chief.shipId, marketing.shipId, design.shipId, product.shipId]);
  });

  it('tells each added ship alone by an added notice from the owner, stating its model, and wakes it (M11)', async () => {
    unwrap(await messaging.addToMeeting(chief, toAdd()));

    const added = core.state.messages.filter(({ contentType, createdAt }) => contentType === MEETING_ADDED_CONTENT_TYPE && createdAt.getTime() === core.clock.now().getTime());
    expect(added.map(({ senderShipId, selector, model, meetingId: of }) => ({ senderShipId, selector, model, meetingId: of }))).toEqual([
      { senderShipId: chief.shipId, selector: { kind: 'ship', shipId: product.shipId }, model: SESSION_MODEL, meetingId },
    ]);
    expect(meetingAddedSchema.parse(JSON.parse(added[0]?.payload ?? '')).participants.map(({ id }) => id)).toEqual([chief.shipId, marketing.shipId, product.shipId]);
    expect(core.state.notices.map(({ recipient }) => recipient)).toEqual([{ kind: 'ship', shipId: product.shipId }]);
  });

  it('writes ParticipantAdded for each added ship, caused by the owner', async () => {
    unwrap(await messaging.addToMeeting(chief, toAdd({ ships: [{ shipId: product.shipId }, { shipId: design.shipId }] })));

    expect(core.state.events.filter(({ type }) => type === 'ParticipantAdded').map(({ shipId, actor, details }) => ({ shipId, actor, details }))).toEqual(
      [product, design].map(({ shipId }) => ({ shipId, actor: { kind: 'ship', shipId: chief.shipId }, details: { meetingId } })),
    );
  });

  it('leaves a ship there already as it is, telling it nothing', async () => {
    const before = core.state.messages.length;

    unwrap(await messaging.addToMeeting(chief, toAdd({ ships: [{ shipId: marketing.shipId }] })));

    expect([participantsOf(), core.state.messages.length, core.state.events]).toEqual([[chief.shipId, marketing.shipId], before, []]);
  });

  it('brings back a ship whose right the owner revoked, as a ship the owner adds (M13)', async () => {
    unwrap(await messaging.changeMeeting(chief, { meetingId, change: { kind: 'revoke', shipId: marketing.shipId } }));

    unwrap(await messaging.addToMeeting(chief, toAdd({ ships: [{ shipId: marketing.shipId }] })));
    unwrap(await messaging.changeMeeting(marketing, { meetingId, change: { kind: 'leave' } }));

    expect((await messaging.changeMeeting(marketing, { meetingId, change: { kind: 'rejoin' } })).isOk).toBe(true);
  });

  it('gives an added ship the deliveries from joining on, and the meeting so far to read (M12)', async () => {
    const before = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'meeting', meetingId }, payload: 'Agenda', idempotencyKey: newKey(), model: SESSION_MODEL })).messageId;
    unwrap(await messaging.addToMeeting(chief, toAdd()));
    const after = unwrap(await messaging.sendMessage(chief, { selector: { kind: 'meeting', meetingId }, payload: 'Welcome', idempotencyKey: newKey(), model: SESSION_MODEL })).messageId;

    const deliveredToProduct = core.state.deliveries.filter(({ recipient, messageId }) => recipient.kind === 'ship' && recipient.shipId === product.shipId && (messageId === before || messageId === after));
    const read = unwrap(await messaging.readMeeting(product, { meetingId, limit: 20 }));

    expect([deliveredToProduct.map(({ messageId }) => messageId), read.contributions.items.map(({ messageId }) => messageId)]).toEqual([[after], [after, before]]);
  });
});

describe('an add the meeting refuses', () => {
  function expectNothingStored(messagesBefore: number): void {
    expect([participantsOf(), core.state.messages.length, core.state.events, core.state.notices]).toEqual([[chief.shipId, marketing.shipId], messagesBefore, [], []]);
  }

  it('refuses a ship the owner does not reach, recording the refusal and adding none of the others (M5)', async () => {
    const before = core.state.messages.length;

    expect(refusalOf(await messaging.addToMeeting(chief, toAdd({ ships: [{ shipId: product.shipId }, { shipId: vault.shipId }] })))).toEqual({ kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' });
    expect(core.state.reachRefusals.map((refusal) => ({ fromShipId: refusedShip(refusal.sender).id, toShipId: refusal.recipient.kind === 'ship' ? refusal.recipient.ship.id : null }))).toContainEqual({ fromShipId: chief.shipId, toShipId: vault.shipId });
    expectNothingStored(before);
  });

  it('is for the owner only', async () => {
    const before = core.state.messages.length;

    expect(refusalOf(await messaging.addToMeeting(marketing, toAdd()))).toEqual({
      kind: 'NOT_OWNER',
      message: `Only the owner of meeting ${meetingId} adds and revokes ships, transfers it and names its moderator`,
    });
    expectNothingStored(before);
  });

  it('refuses an add that names no ship', async () => {
    expect(refusalOf(await messaging.addToMeeting(chief, toAdd({ ships: [] })))).toEqual({ kind: 'MEETING_WITHOUT_INVITEES', message: 'Name the ships to add: by id, by name or by label' });
  });

  it('refuses a ship that does not exist, and a ship that takes no part, as for a meeting that does not exist', async () => {
    expect([
      refusalOf(await messaging.addToMeeting(chief, toAdd({ ships: [{ name: 'nobody' }] }))).kind,
      refusalOf(await messaging.addToMeeting(design, toAdd())),
    ]).toEqual(['UNRESOLVABLE_SELECTOR', { kind: 'MEETING_NOT_FOUND', message: `Meeting ${meetingId} does not exist or you are not one of its participants` }]);
  });

  it('needs the model of an agent owner, as a send does', async () => {
    expect(refusalOf(await messaging.addToMeeting(chief, toAdd({ model: undefined }))).kind).toBe('MODEL_REQUIRED');
  });
});
