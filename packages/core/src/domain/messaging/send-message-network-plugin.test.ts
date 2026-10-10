import type { LabelValueId, WhileUnavailable } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewOfToken, crewShip, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import type { MessageToSend } from './send-message.js';

/**
 * A send while the fleet's networking plugin is unavailable (decision 0035):
 * the plugin is not responding when its ship holds no lease, or its crew made
 * no call for longer than it declared. Then what it declared applies: block
 * all (only the fixed exceptions), open all, or keep the rules it supplied
 * last. Its rules let shared ships reach shared ships: planner and scout are
 * shared, vault is sensitive.
 */
let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let messaging: ReturnType<typeof messagingUseCases>;
let argo: Caller;
let plugin: Caller;
let pluginToken: string;
let planner: Caller;
let scout: Caller;
let vault: Caller;

const NOT_RESPONDING_AFTER_SECONDS = 120;
const SECOND = 1000;
const NOT_REACHABLE = { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' };

function value(text: string): LabelValueId {
  return valueIdOf(core, { key: 'trust', value: text });
}

function aMessage(to: Caller, overrides: Partial<MessageToSend> = {}): MessageToSend {
  return { selector: { kind: 'ship', shipId: to.shipId }, payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/260', idempotencyKey: newKey(), model: SESSION_MODEL, ...overrides };
}

/** The ship registers as the fleet's networking plugin and supplies its rules: shared reaches shared. */
async function registerAs(ship: Caller, whileUnavailable: WhileUnavailable): Promise<void> {
  unwrap(await registry.registerNetworkPlugin(ship, { whileUnavailable, notRespondingAfterSeconds: NOT_RESPONDING_AFTER_SECONDS }));
  unwrap(await registry.setNetworkRules(ship, { rules: [{ from: [value('shared')], to: [value('shared')] }] }));
}

/** The plugin's crew calls the fleet, as every call of its process does. */
async function pluginCalls(): Promise<void> {
  await crewOfToken(core, pluginToken);
}

/** The plugin's crew makes no call for longer than it declared. */
function pluginGoesQuiet(): void {
  core.clock.advance((NOT_RESPONDING_AFTER_SECONDS + 1) * SECOND);
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-10T08:00:00.000Z');
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  const labeller = await shipWithScopes({ registry, argo }, { name: 'labeller', type: 'labeller', scopes: ['labels:define', 'labels:assign'] });
  plugin = await shipWithScopes({ registry, argo }, { name: 'reach', type: 'networking', scopes: ['fleet:network'] });
  pluginToken = crewShip(core, plugin);
  planner = await shipWithScopes({ registry, argo }, { name: 'planner', type: 'planner', scopes: [] });
  scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
  vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'keeper', scopes: [] });
  unwrap(await registry.defineLabel(labeller, { key: 'trust', values: ['shared', 'sensitive'] }));
  const carries: [Caller, string][] = [
    [planner, 'shared'],
    [scout, 'shared'],
    [vault, 'sensitive'],
  ];
  for (const [ship, text] of carries) {
    unwrap(await registry.assignLabel(labeller, { shipId: ship.shipId, valueId: value(text) }));
  }
});

describe('a send while the networking plugin responds', () => {
  beforeEach(async () => {
    await registerAs(plugin, 'block-all');
    await pluginCalls();
  });

  it('follows the rules it supplied', async () => {
    unwrap(await messaging.sendMessage(planner, aMessage(scout)));

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(vault)))).toEqual(NOT_REACHABLE);
  });

  it('still follows them when its crew last called exactly as long ago as it declared', async () => {
    core.clock.advance(NOT_RESPONDING_AFTER_SECONDS * SECOND);

    unwrap(await messaging.sendMessage(planner, aMessage(scout)));
  });

  it('records a refusal as one of the rules, not of an unavailable plugin', async () => {
    refusalOf(await messaging.sendMessage(planner, aMessage(vault)));

    expect(core.state.reachRefusals).toEqual([expect.objectContaining({ settingsVersion: 2, whilePluginUnavailable: null })]);
  });
});

describe('a send while the networking plugin, declared block-all, is not responding', () => {
  beforeEach(async () => {
    await registerAs(plugin, 'block-all');
    await pluginCalls();
  });

  it('is refused even where a rule allows it', async () => {
    pluginGoesQuiet();

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(scout)))).toEqual(NOT_REACHABLE);
  });

  it('records that the plugin was unavailable and declared block-all, with the settings version', async () => {
    pluginGoesQuiet();

    refusalOf(await messaging.sendMessage(planner, aMessage(scout)));

    expect(core.state.reachRefusals).toEqual([expect.objectContaining({ settingsVersion: 2, whilePluginUnavailable: 'block-all' })]);
  });

  it('lets argo send to every ship and every ship send to argo', async () => {
    pluginGoesQuiet();

    unwrap(await messaging.sendMessage(argo, aMessage(vault, { model: undefined })));
    unwrap(await messaging.sendMessage(vault, aMessage(argo)));
  });

  it('lets a ship answer the sender of a message it received', async () => {
    const { messageId } = unwrap(await messaging.sendMessage(scout, aMessage(planner)));
    pluginGoesQuiet();

    unwrap(await messaging.sendMessage(planner, aMessage(scout, { inReplyTo: messageId })));
  });

  it('follows the rules again once the plugin calls the fleet', async () => {
    pluginGoesQuiet();
    await pluginCalls();

    unwrap(await messaging.sendMessage(planner, aMessage(scout)));
  });
});

describe('a send while the networking plugin, declared open-all, is not responding', () => {
  it('goes through between any two ships, as with no rules', async () => {
    await registerAs(plugin, 'open-all');
    pluginGoesQuiet();

    unwrap(await messaging.sendMessage(planner, aMessage(vault)));
  });
});

describe('a send while the networking plugin, declared keep-latest, is not responding', () => {
  beforeEach(async () => {
    await registerAs(plugin, 'keep-latest');
    pluginGoesQuiet();
  });

  it('follows the rules it supplied last', async () => {
    unwrap(await messaging.sendMessage(planner, aMessage(scout)));
  });

  it('is refused where they allow nothing, recording that the plugin was unavailable and declared keep-latest', async () => {
    expect(refusalOf(await messaging.sendMessage(planner, aMessage(vault)))).toEqual(NOT_REACHABLE);
    expect(core.state.reachRefusals).toEqual([expect.objectContaining({ whilePluginUnavailable: 'keep-latest' })]);
  });
});

describe('a send while the networking plugin holds no lease', () => {
  it('follows what the plugin declared at once when its ship was released', async () => {
    await registerAs(plugin, 'block-all');
    await pluginCalls();
    unwrap(await registry.releaseShip(argo, { shipId: plugin.shipId }));

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(scout)))).toEqual(NOT_REACHABLE);
  });

  it('follows what the plugin declared at once when its ship was never crewed', async () => {
    const uncrewed = await shipWithScopes({ registry, argo }, { name: 'reach-two', type: 'networking', scopes: ['fleet:network'] });
    await registerAs(uncrewed, 'block-all');

    expect(refusalOf(await messaging.sendMessage(planner, aMessage(scout)))).toEqual(NOT_REACHABLE);
  });
});

describe('a send once the networking plugin unregistered', () => {
  it("goes through between any two ships, today's all-to-all, whatever the plugin declared", async () => {
    await registerAs(plugin, 'block-all');
    unwrap(await registry.unregisterNetworkPlugin(plugin));
    pluginGoesQuiet();

    unwrap(await messaging.sendMessage(planner, aMessage(vault)));
  });
});
