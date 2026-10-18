import { ANY_LABEL_VALUE, NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS, SAME_LABEL_VALUE, type FleetId, type LabelValueId, type MessageId, type NetworkRule, type SelectorTerm, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { labelIdOf, valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import type { Selector } from '../shared/selector.js';
import { UNDELIVERABLE_AT_ATTEMPT } from './delivery.js';
import type { MessageToSend } from './send-message.js';

/**
 * The fleet's network rules on every send (decision 0034): planner (trust
 * shared, team a), scout (trust shared, team b) and vault (trust sensitive),
 * labelled by the labeller, which owns both labels. The rules come from the
 * fleet's networking plugin, which keeps them while unavailable (decision 0035).
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let planner: Caller;
let scout: Caller;
let vault: Caller;
let labeller: Caller;
let networking: Caller;

const NOT_REACHABLE = { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' };

function value(key: string, text: string): LabelValueId {
  return valueIdOf(core, { key, value: text });
}

/** A term that holds for a ship carrying any value of the label with this key. */
function anyValue(key: string): SelectorTerm {
  return { labelId: labelIdOf(core, key), value: ANY_LABEL_VALUE };
}

/** A term that holds when the ships on both sides carry the same value of the label with this key. */
function sameValue(key: string): SelectorTerm {
  return { labelId: labelIdOf(core, key), value: SAME_LABEL_VALUE };
}

/** Sets the rules as the networking plugin does: open for send off while rules apply, on for none. */
async function setRules(rules: NetworkRule[] | null): Promise<void> {
  unwrap(await registry.setNetworkRules(networking, { rules }));
  unwrap(await registry.setBuiltInRule(networking, { rule: 'open', verb: 'send', isOn: rules === null }));
}

function toShip(ship: Caller): Selector {
  return { kind: 'ship', shipId: ship.shipId };
}

function aMessage(selector: Selector, overrides: Partial<MessageToSend> = {}): MessageToSend {
  return { selector, payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/260', idempotencyKey: newKey(), model: SESSION_MODEL, ...overrides };
}

async function sent(caller: Caller, input: MessageToSend): Promise<MessageId> {
  return unwrap(await messaging.sendMessage(caller, input)).messageId;
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-09T19:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  labeller = await shipWithScopes({ registry, argo }, { name: 'labeller', type: 'networking', scopes: ['labels:define', 'labels:assign'] });
  planner = await shipWithScopes({ registry, argo }, { name: 'planner', type: 'planner', scopes: [] });
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'keeper', scopes: [] });
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  crewAboard(core, networking);
  unwrap(await registry.registerNetworkPlugin(networking, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS }));
  unwrap(await registry.defineLabel(labeller, { key: 'trust', values: ['shared', 'sensitive'] }));
  unwrap(await registry.defineLabel(labeller, { key: 'team', values: ['a', 'b'] }));
  const carries: [Caller, string, string][] = [
    [planner, 'trust', 'shared'],
    [planner, 'team', 'a'],
    [scout, 'trust', 'shared'],
    [scout, 'team', 'b'],
    [vault, 'trust', 'sensitive'],
  ];
  for (const [ship, key, text] of carries) {
    unwrap(await registry.assignLabel(labeller, { shipId: ship.shipId, valueId: value(key, text) }));
  }
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function messagesFrom(shipId: ShipId): MessageId[] {
  return core.state.messages.filter((message) => message.senderShipId === shipId).map((message) => message.id);
}

describe('a send while the fleet has no network rules', () => {
  it("goes through between any two ships, today's all-to-all", async () => {
    await expect(sent(scout, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
  });

  it('goes through again once the rules are cleared', async () => {
    await setRules([]);
    await setRules(null);

    await expect(sent(scout, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
  });
});

describe('a send while the fleet has network rules', () => {
  beforeEach(async () => {
    await setRules([{ verb: 'send', from: [value('trust', 'shared')], to: [value('trust', 'shared')] }]);
    core.state.events.length = 0;
  });

  it('goes through when a rule lets the sender reach the recipient', async () => {
    await expect(sent(planner, aMessage(toShip(scout)))).resolves.toMatch(/^msg_/);
  });

  it('is refused when no rule allows it, saying no reason', async () => {
    const refused = await messaging.sendMessage(planner, aMessage(toShip(vault)));

    expect(refusalOf(refused)).toEqual(NOT_REACHABLE);
  });

  it('is refused the same by name as by id', async () => {
    const refused = await messaging.sendMessage(planner, aMessage({ kind: 'ship', name: 'vault' }));

    expect(refusalOf(refused)).toEqual(NOT_REACHABLE);
  });

  it('stores nothing of a refused send: no message, no delivery, no event, no wake-up', async () => {
    core.state.notices.length = 0;

    refusalOf(await messaging.sendMessage(planner, aMessage(toShip(vault))));

    expect(core.state.messages).toEqual([]);
    expect(core.state.deliveries).toEqual([]);
    expect(core.state.events).toEqual([]);
    expect(core.state.notices).toEqual([]);
  });

  it("leaves a refused send's idempotency key unused, so the same send goes through once a rule allows it", async () => {
    const input = aMessage(toShip(vault));
    refusalOf(await messaging.sendMessage(planner, input));

    await setRules([{ verb: 'send', from: [value('trust', 'shared')], to: [value('trust', 'sensitive')] }]);

    const messageId = await sent(planner, input);
    expect(messagesFrom(planner.shipId)).toEqual([messageId]);
  });

  it('answers a repeat of a message stored before the rules changed with its id: a rule is checked at send time only', async () => {
    const input = aMessage(toShip(scout));
    const messageId = await sent(planner, input);

    await setRules([]);

    await expect(sent(planner, input)).resolves.toBe(messageId);
  });
});

describe('a network rule', () => {
  it('allows one way only: the ship it lets be reached does not reach back by it', async () => {
    await setRules([{ verb: 'send', from: [value('team', 'a')], to: [value('trust', 'sensitive')] }]);

    await expect(sent(planner, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
    expect(refusalOf(await messaging.sendMessage(vault, aMessage(toShip(planner))))).toEqual(NOT_REACHABLE);
  });

  it('matches a ship carrying every value of its selector, and no ship missing one', async () => {
    await setRules([{ verb: 'send', from: [value('trust', 'shared'), value('team', 'a')], to: [value('trust', 'sensitive')] }]);

    await expect(sent(planner, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
    expect(refusalOf(await messaging.sendMessage(scout, aMessage(toShip(vault))))).toEqual(NOT_REACHABLE);
  });

  it('matches every ship with an empty selector', async () => {
    await setRules([{ verb: 'send', from: [], to: [value('trust', 'sensitive')] }]);

    await expect(sent(scout, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
    expect(refusalOf(await messaging.sendMessage(vault, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
  });

  it('lets a send through only by its verb: a read or a manage rule allows no send', async () => {
    await setRules([
      { verb: 'read', from: [], to: [] },
      { verb: 'manage', from: [], to: [] },
    ]);

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
  });

  it('matches no ship with a label value no ship carries', async () => {
    await setRules([{ verb: 'send', from: [core.ids('labelValue')], to: [] }]);

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
  });
});

describe('a selector term of any value', () => {
  beforeEach(async () => {
    await setRules([{ verb: 'send', from: [anyValue('team')], to: [] }]);
  });

  it('holds for a ship carrying the label, whatever its value', async () => {
    await expect(sent(planner, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
    await expect(sent(scout, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
  });

  it('does not hold for a ship carrying no value of the label', async () => {
    expect(refusalOf(await messaging.sendMessage(vault, aMessage(toShip(planner))))).toEqual(NOT_REACHABLE);
  });
});

describe('a selector term of the same value', () => {
  it('holds when both ships carry the same value of the label', async () => {
    await setRules([{ verb: 'send', from: [sameValue('trust')], to: [sameValue('trust')] }]);

    await expect(sent(planner, aMessage(toShip(scout)))).resolves.toMatch(/^msg_/);
  });

  it('does not hold when the ships carry different values of the label', async () => {
    await setRules([{ verb: 'send', from: [sameValue('trust')], to: [sameValue('trust')] }]);

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(vault))))).toEqual(NOT_REACHABLE);
  });

  it('does not hold when one of the ships carries no value of the label', async () => {
    await setRules([{ verb: 'send', from: [sameValue('team')], to: [sameValue('team')] }]);

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(vault))))).toEqual(NOT_REACHABLE);
  });

  it('holds when the ships share one value of the label among the several one of them carries', async () => {
    await setRules([{ verb: 'send', from: [sameValue('team')], to: [sameValue('team')] }]);
    unwrap(await registry.assignLabel(labeller, { shipId: scout.shipId, valueId: value('team', 'a') }));

    await expect(sent(planner, aMessage(toShip(scout)))).resolves.toMatch(/^msg_/);
  });

  it('binds each label on its own when a rule holds several: both values must be the same', async () => {
    const rule = { verb: 'send' as const, from: [sameValue('trust'), sameValue('team')], to: [sameValue('trust'), sameValue('team')] };
    await setRules([rule]);

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
    unwrap(await registry.assignLabel(labeller, { shipId: scout.shipId, valueId: value('team', 'a') }));
    await expect(sent(planner, aMessage(toShip(scout)))).resolves.toMatch(/^msg_/);
  });

  it('holds beside an exact value in the same selector only when both hold', async () => {
    await setRules([{ verb: 'send', from: [value('team', 'a'), sameValue('trust')], to: [sameValue('trust')] }]);

    await expect(sent(planner, aMessage(toShip(scout)))).resolves.toMatch(/^msg_/);
    expect(refusalOf(await messaging.sendMessage(scout, aMessage(toShip(planner))))).toEqual(NOT_REACHABLE);
  });
});

describe('a selector term of the owner (decision 0045)', () => {
  let thomasId: ShipId;
  let annaId: ShipId;

  beforeEach(async () => {
    const person = async (name: string) => unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'person', kind: 'person' })).shipId;
    thomasId = await person('thomas');
    annaId = await person('anna');
    unwrap(await registry.setOwner(argo, { shipId: planner.shipId, ownerShipId: thomasId }));
    unwrap(await registry.setOwner(argo, { shipId: scout.shipId, ownerShipId: thomasId }));
    unwrap(await registry.setOwner(argo, { shipId: vault.shipId, ownerShipId: annaId }));
  });

  it("holds for a ship that owner's ship owns, and for no other", async () => {
    await setRules([{ verb: 'send', from: [{ owner: thomasId }], to: [] }]);

    await expect(sent(planner, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
    expect(refusalOf(await messaging.sendMessage(vault, aMessage(toShip(planner))))).toEqual(NOT_REACHABLE);
  });

  it('holds for a ship with any owner, which every ship but argo and the viewer has', async () => {
    await setRules([{ verb: 'send', from: [], to: [{ owner: ANY_LABEL_VALUE }] }]);

    await expect(sent(vault, aMessage(toShip(planner)))).resolves.toMatch(/^msg_/);
  });

  it('lets ships with the same owner reach each other, and no ship with another owner', async () => {
    await setRules([{ verb: 'send', from: [{ owner: SAME_LABEL_VALUE }], to: [{ owner: SAME_LABEL_VALUE }] }]);

    await expect(sent(planner, aMessage(toShip(scout)))).resolves.toMatch(/^msg_/);
    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(vault))))).toEqual(NOT_REACHABLE);
  });

  it('holds for no ship with an owner no ship has', async () => {
    await setRules([{ verb: 'send', from: [{ owner: core.ids('ship') }], to: [] }]);

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
  });
});

describe('the open rule (decision 0034)', () => {
  beforeEach(async () => {
    await setRules([]);
  });

  it('lets every ship send to every ship while it is on for send, whatever the rules', async () => {
    unwrap(await registry.setBuiltInRule(networking, { rule: 'open', verb: 'send', isOn: true }));

    await expect(sent(vault, aMessage(toShip(scout)))).resolves.toMatch(/^msg_/);
  });

  it('lets no send through while it is on only for read and manage', async () => {
    expect(core.state.networkSettings[0]?.builtIns.open).toEqual({ send: false, read: true, manage: true });

    expect(refusalOf(await messaging.sendMessage(vault, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
  });
});

describe('the fixed exceptions', () => {
  beforeEach(async () => {
    await setRules([]);
  });

  it('let argo send to every ship whatever the rules', async () => {
    await expect(sent(argo, aMessage(toShip(vault), { model: undefined }))).resolves.toMatch(/^msg_/);
  });

  it('let every ship send to argo whatever the rules', async () => {
    await expect(sent(vault, aMessage({ kind: 'ship', name: 'argo' }))).resolves.toMatch(/^msg_/);
  });

  describe("an owner's ship (decision 0045)", () => {
    let thomas: Caller;

    beforeEach(async () => {
      const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
      thomas = { fleetId, shipId, kind: 'person', scopes: ['messages:send', 'messages:receive'] };
      unwrap(await registry.setOwner(argo, { shipId: vault.shipId, ownerShipId: thomas.shipId }));
    });

    it('sends to a ship it owns whatever the rules', async () => {
      await expect(sent(thomas, aMessage(toShip(vault), { model: undefined }))).resolves.toMatch(/^msg_/);
    });

    it('is not reached by the ship it owns', async () => {
      expect(refusalOf(await messaging.sendMessage(vault, aMessage(toShip(thomas))))).toEqual(NOT_REACHABLE);
    });

    it('does not send to a ship it does not own', async () => {
      expect(refusalOf(await messaging.sendMessage(thomas, aMessage(toShip(scout), { model: undefined })))).toEqual(NOT_REACHABLE);
    });
  });

  it('refuse every other send when the rules are an empty list', async () => {
    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
  });
});

describe('an answer', () => {
  let asked: MessageId;

  beforeEach(async () => {
    await setRules([{ verb: 'send', from: [value('team', 'a')], to: [value('trust', 'sensitive')] }]);
    asked = await sent(planner, aMessage(toShip(vault)));
  });

  it('goes to the sender of a message the ship received, whatever the rules', async () => {
    await expect(sent(vault, aMessage(toShip(planner), { inReplyTo: asked }))).resolves.toMatch(/^msg_/);
  });

  it('goes to the sender of a message of its type the ship claimed, whatever the rules', async () => {
    const byType = await sent(planner, aMessage({ kind: 'type', type: 'keeper' }));
    const crew = crewAboard(core, vault);
    unwrap(await messaging.receiveDeliveries(crew, { max: 10 }));

    await expect(sent(vault, aMessage(toShip(planner), { inReplyTo: byType }))).resolves.toMatch(/^msg_/);
  });

  it('is checked by the rules when it goes to another ship than the sender', async () => {
    const refused = await messaging.sendMessage(vault, aMessage(toShip(scout), { inReplyTo: asked }));

    expect(refusalOf(refused)).toEqual(NOT_REACHABLE);
  });

  it('is checked by the rules when the ship did not receive the message it names', async () => {
    const refused = await messaging.sendMessage(scout, aMessage(toShip(planner), { inReplyTo: asked }));

    expect(refusalOf(refused)).toEqual(NOT_REACHABLE);
  });
});

describe('the record of a refused send', () => {
  beforeEach(async () => {
    await setRules([{ verb: 'send', from: [value('trust', 'shared')], to: [value('trust', 'shared')] }]);
  });

  it('says who tried to reach whom, both ships with the labels they carried by key and their owners, the settings version that refused it and when', async () => {
    refusalOf(await messaging.sendMessage(scout, aMessage(toShip(vault))));

    const [refusal] = core.state.reachRefusals;
    expect(refusal?.id).toMatch(/^rfs_/);
    const label = (key: string, text: string) => ({ labelId: core.state.labels.find((held) => held.key === key)?.id, key, valueId: value(key, text), value: text });
    expect(core.state.reachRefusals).toEqual([
      {
        fleetId,
        id: refusal?.id,
        at: core.clock.now(),
        sender: { id: scout.shipId, name: 'scout', labels: [label('team', 'b'), label('trust', 'shared')], owner: { id: argo.shipId, name: 'argo' } },
        recipient: { kind: 'ship', ship: { id: vault.shipId, name: 'vault', labels: [label('trust', 'sensitive')], owner: { id: argo.shipId, name: 'argo' } } },
        settingsVersion: 3,
        whilePluginUnavailable: null,
      },
    ]);
  });

  it('keeps the values of the label both ships carried when a term of the same value refused it', async () => {
    await setRules([{ verb: 'send', from: [sameValue('trust')], to: [sameValue('trust')] }]);

    refusalOf(await messaging.sendMessage(planner, aMessage(toShip(vault))));

    const [refusal] = core.state.reachRefusals;
    const valuesOf = (labels: readonly { key: string; value: string }[] | undefined) => labels?.filter((label) => label.key === 'trust').map((label) => label.value);
    expect([valuesOf(refusal?.sender.labels), refusal?.recipient.kind === 'ship' ? valuesOf(refusal.recipient.ship.labels) : undefined]).toEqual([['shared'], ['sensitive']]);
    expect(refusal?.settingsVersion).toBe(4);
  });

  it('keeps the owner each ship had then, by id and name', async () => {
    const { shipId: thomasId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' }));
    unwrap(await registry.setOwner(argo, { shipId: vault.shipId, ownerShipId: thomasId }));

    refusalOf(await messaging.sendMessage(scout, aMessage(toShip(vault))));

    const [refusal] = core.state.reachRefusals;
    expect([refusal?.sender.owner, refusal?.recipient.kind === 'ship' ? refusal.recipient.ship.owner : undefined]).toEqual([
      { id: argo.shipId, name: 'argo' },
      { id: thomasId, name: 'thomas' },
    ]);
  });

  it('names the version of the settings that refused it', async () => {
    await setRules([]);

    refusalOf(await messaging.sendMessage(scout, aMessage(toShip(vault))));

    expect(core.state.reachRefusals.map((refusal) => refusal.settingsVersion)).toEqual([4]);
  });

  it('is kept for every refusal, and for nothing that went through', async () => {
    await sent(planner, aMessage(toShip(scout)));
    await sent(argo, aMessage(toShip(vault), { model: undefined }));
    refusalOf(await messaging.sendMessage(scout, aMessage(toShip(vault))));
    refusalOf(await messaging.sendMessage(planner, aMessage(toShip(vault))));

    expect(core.state.reachRefusals.map((refusal) => refusal.sender.name)).toEqual(['scout', 'planner']);
  });
});

describe('a send to a type while the fleet has network rules', () => {
  let keeper: Caller;
  const toKeepers: Selector = { kind: 'type', type: 'keeper' };

  beforeEach(async () => {
    // A second ship of vault's type, keeper, that shared ships may reach.
    keeper = await shipWithScopes({ registry, argo }, { name: 'keeper', type: 'keeper', scopes: [] });
    unwrap(await registry.assignLabel(labeller, { shipId: keeper.shipId, valueId: value('trust', 'shared') }));
    await setRules([{ verb: 'send', from: [value('trust', 'shared')], to: [value('trust', 'shared')] }]);
  });

  async function received(ship: Caller): Promise<MessageId[]> {
    const crew = crewAboard(core, ship);
    return unwrap(await messaging.receiveDeliveries(crew, { max: 10 })).deliveries.map((delivery) => delivery.messageId);
  }

  it('stores with its delivery the ships of the type the sender may reach, and only those', async () => {
    const messageId = await sent(planner, aMessage(toKeepers));

    expect(core.state.deliveries.find((delivery) => delivery.messageId === messageId)?.reachableShipIds).toEqual([keeper.shipId]);
  });

  it('lets only a ship the sender may reach claim it', async () => {
    const messageId = await sent(planner, aMessage(toKeepers));

    await expect(received(vault)).resolves.toEqual([]);
    await expect(received(keeper)).resolves.toEqual([messageId]);
  });

  it("counts it only in the inbox of a ship that may claim it", async () => {
    await sent(planner, aMessage(toKeepers));

    await expect(messaging.checkInbox(crewAboard(core, vault), { waitSeconds: 0 })).resolves.toEqual({ isOk: true, value: { waiting: 0, forced: 0 } });
    await expect(messaging.checkInbox(crewAboard(core, keeper), { waitSeconds: 0 })).resolves.toEqual({ isOk: true, value: { waiting: 1, forced: 0 } });
  });

  it('keeps the ships fixed at send time: a ship of the type commissioned after it cannot claim it', async () => {
    await sent(planner, aMessage(toKeepers));
    const later = await shipWithScopes({ registry, argo }, { name: 'keeper-2', type: 'keeper', scopes: [] });

    await expect(received(later)).resolves.toEqual([]);
  });

  it('is refused when the sender may reach no ship of the type, recording the type and each ship of it with its labels', async () => {
    unwrap(await registry.retireShip(argo, { shipId: keeper.shipId }));
    core.state.reachRefusals.length = 0;

    const refused = await messaging.sendMessage(planner, aMessage(toKeepers));

    expect(refusalOf(refused)).toEqual(NOT_REACHABLE);
    expect(core.state.deliveries).toEqual([]);
    expect(core.state.reachRefusals.map((refusal) => refusal.recipient)).toEqual([
      { kind: 'type', type: 'keeper', ships: [{ id: vault.shipId, name: 'vault', labels: [{ labelId: core.state.labels.find((held) => held.key === 'trust')?.id, key: 'trust', valueId: value('trust', 'sensitive'), value: 'sensitive' }], owner: { id: argo.shipId, name: 'argo' } }] },
    ]);
  });

  it('stores as claimants only the ships of the type with the same value a term of the same value asks', async () => {
    await setRules([{ verb: 'send', from: [sameValue('trust')], to: [sameValue('trust')] }]);

    const messageId = await sent(planner, aMessage(toKeepers));

    expect(core.state.deliveries.find((delivery) => delivery.messageId === messageId)?.reachableShipIds).toEqual([keeper.shipId]);
  });

  it('stores as claimants the ships of the type carrying the label a term of any value asks', async () => {
    unwrap(await registry.assignLabel(labeller, { shipId: keeper.shipId, valueId: value('team', 'b') }));
    await setRules([{ verb: 'send', from: [], to: [anyValue('team')] }]);

    const messageId = await sent(planner, aMessage(toKeepers));

    expect(core.state.deliveries.find((delivery) => delivery.messageId === messageId)?.reachableShipIds).toEqual([keeper.shipId]);
  });

  it("leaves argo's send to a type open to every ship of the type", async () => {
    const messageId = await sent(argo, aMessage(toKeepers, { model: undefined }));

    expect(core.state.deliveries.find((delivery) => delivery.messageId === messageId)?.reachableShipIds).toBeUndefined();
  });
});

describe('a send to a type while the fleet has no network rules', () => {
  it('stays open to every ship of the type, as today', async () => {
    const messageId = await sent(planner, aMessage({ kind: 'type', type: 'keeper' }));

    expect(core.state.deliveries.find((delivery) => delivery.messageId === messageId)?.reachableShipIds).toBeUndefined();
  });
});

describe("the operator's resend of an undeliverable delivery", () => {
  let undeliverable: { messageId: MessageId; deliveryId: string };

  beforeEach(async () => {
    await setRules([{ verb: 'send', from: [value('team', 'a')], to: [value('trust', 'sensitive')] }]);
    const messageId = await sent(planner, aMessage(toShip(vault)));
    const crew = crewAboard(core, vault);
    for (let claim = 0; claim < UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
      unwrap(await messaging.receiveDeliveries(crew, { max: 10 }));
    }
    const delivery = core.state.deliveries.find((held) => held.messageId === messageId);
    expect(delivery?.state).toBe('undeliverable');
    undeliverable = { messageId, deliveryId: delivery?.id ?? '' };
  });

  it('goes through when the rules let the original sender reach its recipient', async () => {
    await expect(messaging.resendDelivery(argo, { deliveryId: deliveryIdOf(core, undeliverable.messageId) })).resolves.toMatchObject({ isOk: true });
  });

  it('is refused when the rules no longer let the original sender reach it, leaving the delivery undeliverable for Dismiss', async () => {
    await setRules([]);
    const before = core.state.messages.length;

    const refused = await messaging.resendDelivery(argo, { deliveryId: deliveryIdOf(core, undeliverable.messageId) });

    expect(refusalOf(refused)).toEqual(NOT_REACHABLE);
    expect(core.state.messages).toHaveLength(before);
    expect(core.state.deliveries.find((held) => held.id === undeliverable.deliveryId)?.state).toBe('undeliverable');
  });

  it('is recorded as the original sender trying to reach its recipient', async () => {
    await setRules([]);

    refusalOf(await messaging.resendDelivery(argo, { deliveryId: deliveryIdOf(core, undeliverable.messageId) }));

    expect(core.state.reachRefusals.map((refusal) => [refusal.sender.name, refusal.recipient.kind === 'ship' ? refusal.recipient.ship.name : refusal.recipient.type, refusal.settingsVersion])).toEqual([
      ['planner', 'vault', 4],
    ]);
  });
});
