import type { FleetId, LabelValueId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusedShip } from '../../../test/support/refused-sender.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import type { MessageToSend } from './send-message.js';

/**
 * A send to a label (decision 0063): lead tells every ship labelled
 * `team=a`. alpha, bravo and charlie carry team=a, lead carries it too, and
 * delta carries team=b. alpha and bravo also carry site=north.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let lead: ShipCaller;
let alpha: ShipCaller;
let bravo: ShipCaller;
let charlie: ShipCaller;
let delta: ShipCaller;

function value(key: string, text: string): LabelValueId {
  return valueIdOf(core, { key, value: text });
}

function toTeamA(overrides: Partial<MessageToSend> = {}): MessageToSend {
  return { selector: { kind: 'label', valueIds: [value('team', 'a')] }, payload: 'main is red', idempotencyKey: newKey(), model: SESSION_MODEL, ...overrides };
}

async function sent(input: MessageToSend = toTeamA()): Promise<MessageId> {
  return unwrap(await messaging.sendMessage(lead, input)).messageId;
}

function recipientsOf(messageId: MessageId): ShipId[] {
  return core.state.deliveries.filter((delivery) => delivery.messageId === messageId).flatMap(({ recipient }) => (recipient.kind === 'ship' ? [recipient.shipId] : []));
}

function byId(...ships: ShipCaller[]): ShipId[] {
  return ships.map((ship) => ship.shipId).sort();
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  lead = await shipWithScopes({ registry, argo }, { name: 'lead', type: 'orchestrator', scopes: [] });
  alpha = await shipWithScopes({ registry, argo }, { name: 'alpha', type: 'implementer', scopes: [] });
  bravo = await shipWithScopes({ registry, argo }, { name: 'bravo', type: 'implementer', scopes: [] });
  charlie = await shipWithScopes({ registry, argo }, { name: 'charlie', type: 'reviewer', scopes: [] });
  delta = await shipWithScopes({ registry, argo }, { name: 'delta', type: 'implementer', scopes: [] });
  unwrap(await registry.defineLabel(argo, { key: 'team', values: ['a', 'b'] }));
  unwrap(await registry.defineLabel(argo, { key: 'site', values: ['north', 'south'] }));
  for (const [ship, key, text] of [
    [lead, 'team', 'a'],
    [alpha, 'team', 'a'],
    [bravo, 'team', 'a'],
    [charlie, 'team', 'a'],
    [delta, 'team', 'b'],
    [alpha, 'site', 'north'],
    [bravo, 'site', 'north'],
  ] as const) {
    unwrap(await registry.assignLabel(argo, { shipId: ship.shipId, valueId: value(key, text) }));
  }
  core.clock.advance(60_000);
  core.state.events.length = 0;
  core.state.notices.length = 0;
});

describe('a send to a label', () => {
  it('stores one message keeping its selection as sent, with one pending delivery per ship carrying the value', async () => {
    const messageId = await sent();

    expect(core.state.messages).toEqual([
      expect.objectContaining({ id: messageId, senderShipId: lead.shipId, selector: { kind: 'label', valueIds: [value('team', 'a')] }, payload: 'main is red', model: SESSION_MODEL }),
    ]);
    expect(core.state.deliveries.map(({ messageId: of, state, isForced }) => ({ of, state, isForced }))).toEqual(
      Array.from({ length: 3 }, () => ({ of: messageId, state: 'pending', isForced: false })),
    );
    expect(recipientsOf(messageId).sort()).toEqual(byId(alpha, bravo, charlie));
  });

  it('never sends to the sender, though it carries the value (D7)', async () => {
    const messageId = await sent();

    expect(recipientsOf(messageId)).not.toContain(lead.shipId);
  });

  it('selects only the ships carrying every value of the selection', async () => {
    const messageId = await sent(toTeamA({ selector: { kind: 'label', valueIds: [value('team', 'a'), value('site', 'north')] } }));

    expect(recipientsOf(messageId).sort()).toEqual(byId(alpha, bravo));
  });

  it('writes MessageAccepted for each delivery, naming its ship, and wakes each ship', async () => {
    const messageId = await sent();

    const deliveries = core.state.deliveries;
    expect(core.state.events.map(({ type, shipId, messageId: of, deliveryId, details }) => ({ type, shipId, of, deliveryId, details }))).toEqual(
      deliveries.map((delivery) => ({
        type: 'MessageAccepted',
        shipId: delivery.recipient.kind === 'ship' ? delivery.recipient.shipId : undefined,
        of: messageId,
        deliveryId: delivery.id,
        details: { selector: 'label', recipientType: null, model: SESSION_MODEL },
      })),
    );
    expect(core.state.notices.map((notice) => notice.deliveryId)).toEqual(deliveries.map((delivery) => delivery.id));
  });

  it('leaves out a retired ship carrying the value', async () => {
    unwrap(await registry.retireShip(argo, { shipId: charlie.shipId }));

    const messageId = await sent();

    expect(recipientsOf(messageId).sort()).toEqual(byId(alpha, bravo));
  });

  it('includes a ship awaiting crew: its delivery waits', async () => {
    const echo = await shipWithScopes({ registry, argo }, { name: 'echo', type: 'implementer', scopes: [] });
    unwrap(await registry.assignLabel(argo, { shipId: echo.shipId, valueId: value('team', 'a') }));

    const messageId = await sent();

    expect(recipientsOf(messageId).sort()).toEqual(byId(alpha, bravo, charlie, echo));
  });

  it('forces every delivery of a forced send', async () => {
    const forcer = await shipWithScopes({ registry, argo }, { name: 'forcer', type: 'orchestrator', scopes: ['messages:force'] });

    unwrap(await messaging.sendMessage(forcer, toTeamA({ isForced: true })));

    expect(core.state.deliveries.map((delivery) => delivery.isForced)).toEqual([true, true, true]);
  });

  it('names the message it replies to', async () => {
    const asked = unwrap(await messaging.sendMessage(alpha, { selector: { kind: 'ship', shipId: lead.shipId }, payload: 'is main red?', idempotencyKey: newKey(), model: SESSION_MODEL })).messageId;

    const messageId = await sent(toTeamA({ inReplyTo: asked }));

    expect(core.state.messages.find((message) => message.id === messageId)?.inReplyToMessageId).toBe(asked);
  });
});

describe('a repeat of a send to a label', () => {
  it('answers the first message after the label moved, and stores nothing new', async () => {
    const input = toTeamA();
    const messageId = await sent(input);
    unwrap(await registry.unassignLabel(argo, { shipId: charlie.shipId, valueId: value('team', 'a') }));
    unwrap(await registry.assignLabel(argo, { shipId: delta.shipId, valueId: value('team', 'a') }));

    await expect(sent(input)).resolves.toBe(messageId);
    expect(core.state.messages).toHaveLength(1);
    expect(recipientsOf(messageId).sort()).toEqual(byId(alpha, bravo, charlie));
  });

  it('is another request with the values in another order: the selection is kept as sent', async () => {
    const input = toTeamA({ selector: { kind: 'label', valueIds: [value('team', 'a'), value('site', 'north')] } });
    await sent(input);

    const refused = await messaging.sendMessage(lead, { ...input, selector: { kind: 'label', valueIds: [value('site', 'north'), value('team', 'a')] } });

    expect(refusalOf(refused).kind).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('a send to a label refused', () => {
  it('refuses a value no ship carries, storing nothing', async () => {
    const refused = await messaging.sendMessage(lead, toTeamA({ selector: { kind: 'label', valueIds: [value('site', 'south')] } }));

    expect(refusalOf(refused)).toEqual({ kind: 'UNRESOLVABLE_SELECTOR', message: 'No ship but the sender carries every value of the label selection' });
    expect([core.state.messages, core.state.deliveries, core.state.events, core.state.notices]).toEqual([[], [], [], []]);
  });

  it('refuses an unknown value id', async () => {
    const refused = await messaging.sendMessage(lead, toTeamA({ selector: { kind: 'label', valueIds: [core.ids('labelValue')] } }));

    expect(refusalOf(refused).kind).toBe('UNRESOLVABLE_SELECTOR');
  });

  it('refuses a selection only the sender carries', async () => {
    const solo = await shipWithScopes({ registry, argo }, { name: 'solo', type: 'implementer', scopes: [] });
    unwrap(await registry.assignLabel(argo, { shipId: solo.shipId, valueId: value('site', 'south') }));

    const refused = await messaging.sendMessage(solo, toTeamA({ selector: { kind: 'label', valueIds: [value('site', 'south')] } }));

    expect(refusalOf(refused).kind).toBe('UNRESOLVABLE_SELECTOR');
  });
});

describe('a send to a label under network rules (D4)', () => {
  beforeEach(async () => {
    const networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
    unwrap(await registry.defineLabel(argo, { key: 'reach', values: ['open'] }));
    for (const ship of [alpha, bravo]) {
      unwrap(await registry.assignLabel(argo, { shipId: ship.shipId, valueId: value('reach', 'open') }));
    }
    await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [value('team', 'a')], to: [value('reach', 'open')] }] });
    core.state.events.length = 0;
    core.state.notices.length = 0;
  });

  it('refuses the whole send when one ship of the list is out of reach, recording the refusal and storing nothing else', async () => {
    const refused = await messaging.sendMessage(lead, toTeamA());

    expect(refusalOf(refused)).toEqual({ kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' });
    expect(core.state.reachRefusals.map((refusal) => [refusedShip(refusal.sender).id, refusal.recipient.kind === 'ship' ? refusal.recipient.ship.id : null])).toEqual([
      [lead.shipId, charlie.shipId],
    ]);
    expect([core.state.messages, core.state.deliveries, core.state.events, core.state.notices]).toEqual([[], [], [], []]);
  });

  it('sends when the sender reaches every ship of the list', async () => {
    const messageId = await sent(toTeamA({ selector: { kind: 'label', valueIds: [value('reach', 'open')] } }));

    expect(recipientsOf(messageId).sort()).toEqual(byId(alpha, bravo));
  });
});
