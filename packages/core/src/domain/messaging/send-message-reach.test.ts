import type { FleetId, LabelValueId, MessageId, NetworkRule, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import type { Selector } from '../shared/selector.js';
import type { MessageToSend } from './send-message.js';

/**
 * The fleet's network rules on every send (decision 0033): planner (trust
 * shared, team a), scout (trust shared, team b) and vault (trust sensitive),
 * labelled by the labeller, which owns both labels.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: Caller;
let planner: Caller;
let scout: Caller;
let vault: Caller;

const NOT_REACHABLE = { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' };

function value(key: string, text: string): LabelValueId {
  return valueIdOf(core, { key, value: text });
}

async function setRules(rules: NetworkRule[] | null): Promise<void> {
  unwrap(await registry.setNetworkRules(argo, { rules }));
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
  const labeller = await shipWithScopes({ registry, argo }, { name: 'labeller', type: 'networking', scopes: ['labels:define', 'labels:assign'] });
  planner = await shipWithScopes({ registry, argo }, { name: 'planner', type: 'planner', scopes: [] });
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'keeper', scopes: [] });
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
    await setRules([{ from: [value('trust', 'shared')], to: [value('trust', 'shared')] }]);
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

    await setRules([{ from: [value('trust', 'shared')], to: [value('trust', 'sensitive')] }]);

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
    await setRules([{ from: [value('team', 'a')], to: [value('trust', 'sensitive')] }]);

    await expect(sent(planner, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
    expect(refusalOf(await messaging.sendMessage(vault, aMessage(toShip(planner))))).toEqual(NOT_REACHABLE);
  });

  it('matches a ship carrying every value of its selector, and no ship missing one', async () => {
    await setRules([{ from: [value('trust', 'shared'), value('team', 'a')], to: [value('trust', 'sensitive')] }]);

    await expect(sent(planner, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
    expect(refusalOf(await messaging.sendMessage(scout, aMessage(toShip(vault))))).toEqual(NOT_REACHABLE);
  });

  it('matches every ship with an empty selector', async () => {
    await setRules([{ from: [], to: [value('trust', 'sensitive')] }]);

    await expect(sent(scout, aMessage(toShip(vault)))).resolves.toMatch(/^msg_/);
    expect(refusalOf(await messaging.sendMessage(vault, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
  });

  it('matches no ship with a label value no ship carries', async () => {
    await setRules([{ from: [core.ids('labelValue')], to: [] }]);

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
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

  it('refuse every other send when the rules are an empty list', async () => {
    expect(refusalOf(await messaging.sendMessage(planner, aMessage(toShip(scout))))).toEqual(NOT_REACHABLE);
  });
});

describe('an answer', () => {
  let asked: MessageId;

  beforeEach(async () => {
    await setRules([{ from: [value('team', 'a')], to: [value('trust', 'sensitive')] }]);
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
    await setRules([{ from: [value('trust', 'shared')], to: [value('trust', 'shared')] }]);
  });

  it('says who tried to reach whom, both ships with the labels they carried by key, the settings version that refused it and when', async () => {
    refusalOf(await messaging.sendMessage(scout, aMessage(toShip(vault))));

    const [refusal] = core.state.reachRefusals;
    expect(refusal?.id).toMatch(/^rfs_/);
    const label = (key: string, text: string) => ({ labelId: core.state.labels.find((held) => held.key === key)?.id, key, valueId: value(key, text), value: text });
    expect(core.state.reachRefusals).toEqual([
      {
        fleetId,
        id: refusal?.id,
        at: core.clock.now(),
        sender: { id: scout.shipId, name: 'scout', labels: [label('team', 'b'), label('trust', 'shared')] },
        recipient: { kind: 'ship', ship: { id: vault.shipId, name: 'vault', labels: [label('trust', 'sensitive')] } },
        settingsVersion: 1,
      },
    ]);
  });

  it('names the version of the settings that refused it', async () => {
    await setRules([]);

    refusalOf(await messaging.sendMessage(scout, aMessage(toShip(vault))));

    expect(core.state.reachRefusals.map((refusal) => refusal.settingsVersion)).toEqual([2]);
  });

  it('is kept for every refusal, and for nothing that went through', async () => {
    await sent(planner, aMessage(toShip(scout)));
    await sent(argo, aMessage(toShip(vault), { model: undefined }));
    refusalOf(await messaging.sendMessage(scout, aMessage(toShip(vault))));
    refusalOf(await messaging.sendMessage(planner, aMessage(toShip(vault))));

    expect(core.state.reachRefusals.map((refusal) => refusal.sender.name)).toEqual(['scout', 'planner']);
  });
});
