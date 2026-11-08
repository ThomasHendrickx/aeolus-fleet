import type { MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

/**
 * Plugins are always reachable (decision 0034): in a fleet with its own
 * rules applied, every ship sends to a ship of kind plugin and a ship of
 * kind plugin sends to every ship, by two built-in rules never off. scout
 * and vault have no rule between them or with the plugin.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: ShipCaller;
let scout: ShipCaller;
let vault: ShipCaller;
let plugin: ShipCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-08T10:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'keeper', scopes: [] });
  const { shipId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'plugin', scopes: [] }));
  plugin = { fleetId: fleet.fleetId, shipId, kind: 'plugin', scopes: ['messages:send', 'messages:receive'] };
  await applyNetworkRules(registry, { by: argo, rules: [] });
  core.clock.advance(60_000);
});

async function sendOf(sender: ShipCaller, recipient: ShipCaller) {
  // A plugin ship states no model; an agent ship does.
  const model = sender.kind === 'plugin' ? {} : { model: SESSION_MODEL };
  return messaging.sendMessage(sender, { selector: { kind: 'ship', shipId: recipient.shipId }, payload: '{}', idempotencyKey: newKey(), ...model });
}

async function sent(sender: ShipCaller, recipient: ShipCaller): Promise<MessageId> {
  return unwrap(await sendOf(sender, recipient)).messageId;
}

describe('plugins are always reachable (decision 0034)', () => {
  it('a ship with no rule sends to a plugin ship in a fleet with its own rules applied', async () => {
    // Given scout has no rule that reaches the plugin ship, and none reaches vault
    expect(refusalOf(await sendOf(scout, vault))).toEqual({ kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' });

    // When scout sends the plugin ship a message
    const messageId = await sent(scout, plugin);

    // Then it is stored
    expect(core.state.messages.map((message) => message.id)).toContain(messageId);
  });

  it('a plugin ship sends to a ship with no rule in a fleet with its own rules applied, not as an answer', async () => {
    // Given the plugin ship has no rule that reaches scout
    // When it sends scout a message that answers nothing
    const messageId = await sent(plugin, scout);

    // Then it is stored
    expect(core.state.messages.map((message) => message.id)).toContain(messageId);
  });

  it('names the built-in rules that let a ship send to a plugin ship and a plugin ship send to a ship', async () => {
    const toPlugin = unwrap(await registry.explainReach(argo, { fromShipId: scout.shipId, toShipId: plugin.shipId }));
    const fromPlugin = unwrap(await registry.explainReach(argo, { fromShipId: plugin.shipId, toShipId: scout.shipId }));

    expect(toPlugin.send).toEqual([{ shipId: plugin.shipId, rule: { builtIn: 'sendToPlugin' } }]);
    expect(fromPlugin.send).toEqual([{ shipId: scout.shipId, rule: { builtIn: 'pluginSend' } }]);
  });

  it.each(['sendToPlugin', 'pluginSend'] as const)('refuses turning %s off, and changes nothing', async (rule) => {
    expect(refusalOf(await registry.setBuiltInRule(argo, { rule, isOn: false }))).toEqual({ kind: 'BUILT_IN_RULE_FIXED', message: `The built-in rule ${rule} is never off (decision 0034)` });
    await expect(sent(scout, plugin)).resolves.toMatch(/^msg_/);
  });
});
