import { createIdGenerator, NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS, type LabelId, type LabelValueId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createSendMessage } from '../src/domain/messaging/send-message.js';
import { createSetNetworkRules } from '../src/domain/registry/set-network-rules.js';
import type { Caller } from '../src/domain/shared/caller.js';
import type { Crew } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller, secretOf, SESSION_MODEL } from './support/core-fixtures.js';
import { newKey } from './support/keys.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { refusalOf, unwrap } from './support/result.js';

// The fleet's network rules on a real Postgres (decision 0034): the settings
// kept with their version; a refused send stores nothing but its record, in
// the transaction that refuses it; an answer found by its message's delivery;
// and a send and a change of rules taking turns on the settings, so every
// send is checked against exactly one version.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: Caller;
let planner: Caller;
let vault: Caller;
let labeller: Caller;
let trustId: LabelId;
let shared: LabelValueId;
let sensitive: LabelValueId;

async function aShip(name: string): Promise<Caller> {
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: name }));
  return { fleetId: argo.fleetId, shipId, kind: 'agent', scopes: ['messages:send', 'messages:receive'] };
}

/**
 * The fleet's networking plugin, crewed and registered, keeping its rules while
 * unavailable: the one ship that sets the rules (decision 0035).
 */
async function registeredPlugin(): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'networking', type: 'networking', fleetScopes: ['fleet:network'] }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'aeolus-networking-plugin' }));
  const crew = unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
  unwrap(await core.useCases.registerNetworkPlugin(crew, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS }));
  return crew;
}

function aMessage(to: Caller, inReplyTo?: MessageId) {
  return { selector: { kind: 'ship' as const, shipId: to.shipId }, payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/260', idempotencyKey: newKey(), model: SESSION_MODEL, inReplyTo };
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId: labellerId } = unwrap(
    await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'labeller', type: 'networking', fleetScopes: ['labels:define', 'labels:assign'] }),
  );
  labeller = { fleetId: argo.fleetId, shipId: labellerId, kind: 'agent', scopes: ['labels:define', 'labels:assign'] };
  planner = await aShip('planner');
  vault = await aShip('vault');
  const trust = unwrap(await core.useCases.defineLabel(labeller, { key: 'trust', values: ['shared', 'sensitive'] }));
  trustId = trust.labelId;
  shared = trust.values[0]?.id ?? newId('labelValue');
  sensitive = trust.values[1]?.id ?? newId('labelValue');
  unwrap(await core.useCases.assignLabel(labeller, { shipId: planner.shipId, valueId: shared }));
  unwrap(await core.useCases.assignLabel(labeller, { shipId: vault.shipId, valueId: sensitive }));
});

afterEach(async () => {
  await core.close();
});

async function stored() {
  const [messages, deliveries, accepted] = await Promise.all([
    core.prisma.message.count(),
    core.prisma.delivery.count(),
    core.prisma.event.count({ where: { type: 'MessageAccepted' } }),
  ]);
  return { messages, deliveries, accepted };
}

describe('the network settings', () => {
  let networking: Crew;

  beforeEach(async () => {
    networking = await registeredPlugin();
  });

  it('keep the rules the plugin set, at a version that moves on every set', async () => {
    unwrap(await core.useCases.setNetworkRules(networking, { rules: [{ from: [shared], to: [] }] }));
    const rules = [{ from: [shared, sensitive], to: [sensitive] }, { from: [], to: [] }];

    expect(unwrap(await core.useCases.setNetworkRules(networking, { rules }))).toEqual({ version: 3 });
    await expect(core.prisma.networkSettings.findMany({ select: { fleetId: true, rules: true, version: true } })).resolves.toEqual([
      { fleetId: argo.fleetId, rules, version: 3 },
    ]);
  });

  it('keep none once cleared, at the next version', async () => {
    unwrap(await core.useCases.setNetworkRules(networking, { rules: [] }));

    expect(unwrap(await core.useCases.setNetworkRules(networking, { rules: null }))).toEqual({ version: 3 });
    await expect(core.prisma.networkSettings.findMany({ select: { rules: true, version: true } })).resolves.toEqual([{ rules: null, version: 3 }]);
  });

  it('write NetworkRulesSet with the change, in the same transaction', async () => {
    unwrap(await core.useCases.setNetworkRules(networking, { rules: [] }));

    await expect(core.prisma.event.findMany({ where: { type: 'NetworkRulesSet' }, select: { details: true } })).resolves.toEqual([{ details: { version: 2, rules: 0 } }]);
  });
});

describe('the networking plugin (decision 0035)', () => {
  let plugin: Caller;
  let pluginSecret: string;

  beforeEach(async () => {
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'reach', type: 'networking', fleetScopes: ['fleet:network'] }));
    plugin = { fleetId: argo.fleetId, shipId, kind: 'agent', scopes: ['fleet:network'] };
    pluginSecret = secretOf(secret);
  });

  it('is kept with what it declared, at the next version, with NetworkPluginRegistered in the same transaction', async () => {
    expect(unwrap(await core.useCases.registerNetworkPlugin(plugin, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 }))).toEqual({ version: 1 });

    await expect(core.prisma.networkSettings.findMany({ select: { rules: true, version: true, pluginShipId: true, pluginWhileUnavailable: true, pluginNotRespondingAfterSeconds: true } })).resolves.toEqual([
      { rules: null, version: 1, pluginShipId: plugin.shipId, pluginWhileUnavailable: 'keep-latest', pluginNotRespondingAfterSeconds: 300 },
    ]);
    await expect(core.prisma.event.count({ where: { type: 'NetworkPluginRegistered' } })).resolves.toBe(1);
  });

  it('alone sets the rules while registered', async () => {
    unwrap(await core.useCases.registerNetworkPlugin(plugin, { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 }));

    expect(refusalOf(await core.useCases.setNetworkRules(argo, { rules: [] }))).toMatchObject({ kind: 'NOT_THE_NETWORK_PLUGIN' });
    expect(unwrap(await core.useCases.setNetworkRules(plugin, { rules: [] }))).toEqual({ version: 2 });
  });

  it('unregistered, leaves no plugin and no rules, with NetworkPluginUnregistered in the same transaction', async () => {
    unwrap(await core.useCases.registerNetworkPlugin(plugin, { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 }));
    unwrap(await core.useCases.setNetworkRules(plugin, { rules: [] }));

    expect(unwrap(await core.useCases.unregisterNetworkPlugin(plugin))).toEqual({ version: 3 });
    await expect(core.prisma.networkSettings.findMany({ select: { rules: true, version: true, pluginShipId: true, pluginWhileUnavailable: true, pluginNotRespondingAfterSeconds: true } })).resolves.toEqual([
      { rules: null, version: 3, pluginShipId: null, pluginWhileUnavailable: null, pluginNotRespondingAfterSeconds: null },
    ]);
    await expect(core.prisma.event.count({ where: { type: 'NetworkPluginUnregistered' } })).resolves.toBe(1);
  });

  it('not responding, its declaration applies, judged by its lease\'s last seen, and the refusal says so', async () => {
    unwrap(await core.useCases.registerNetworkPlugin(plugin, { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 120 }));
    unwrap(await core.useCases.setNetworkRules(plugin, { rules: [{ from: [shared], to: [sensitive] }] }));
    unwrap(await core.useCases.claimShip({ shipId: plugin.shipId, secret: pluginSecret, location: { kind: 'SERVER' }, harness: 'aeolus-networking' }));
    core.clock.advance(120_000);
    refusalOf(await core.useCases.sendMessage(vault, aMessage(planner)));
    core.clock.advance(1000);

    refusalOf(await core.useCases.sendMessage(vault, aMessage(planner)));

    await expect(core.prisma.reachRefusal.findMany({ select: { whilePluginUnavailable: true }, orderBy: { at: 'asc' } })).resolves.toEqual([
      { whilePluginUnavailable: null },
      { whilePluginUnavailable: 'keep-latest' },
    ]);
  });

  it('retired, unregisters in the retirement\'s transaction', async () => {
    unwrap(await core.useCases.registerNetworkPlugin(plugin, { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 }));

    unwrap(await core.useCases.retireShip(argo, { shipId: plugin.shipId }));

    await expect(core.prisma.networkSettings.findMany({ select: { rules: true, version: true, pluginShipId: true } })).resolves.toEqual([{ rules: null, version: 2, pluginShipId: null }]);
  });
});

describe('a send under network rules', () => {
  let networking: Crew;

  beforeEach(async () => {
    networking = await registeredPlugin();
    unwrap(await core.useCases.setNetworkRules(networking, { rules: [{ from: [shared], to: [sensitive] }] }));
  });

  it('goes through when a rule allows it', async () => {
    unwrap(await core.useCases.sendMessage(planner, aMessage(vault)));

    await expect(stored()).resolves.toEqual({ messages: 1, deliveries: 1, accepted: 1 });
  });

  it('is refused when no rule allows it, storing no message, no delivery and no event, only its record', async () => {
    const refused = await core.useCases.sendMessage(vault, aMessage(planner));

    expect(refusalOf(refused)).toEqual({ kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' });
    await expect(stored()).resolves.toEqual({ messages: 0, deliveries: 0, accepted: 0 });
    await expect(core.prisma.reachRefusal.count()).resolves.toBe(1);
  });

  it('records who tried to reach whom, both ships with the labels they carried, the settings version and when', async () => {
    refusalOf(await core.useCases.sendMessage(vault, aMessage(planner)));
    const label = (valueId: LabelValueId, value: string) => ({ labelId: trustId, key: 'trust', valueId, value });

    const read = unwrap(await core.useCases.readReachRefusals(argo));

    expect(read[0]?.id).toMatch(/^rfs_/);
    expect(read).toEqual([
        {
          fleetId: argo.fleetId,
          id: read[0]?.id,
          at: core.clock.now(),
          sender: { id: vault.shipId, name: 'vault', labels: [label(sensitive, 'sensitive')] },
          recipient: { kind: 'ship', ship: { id: planner.shipId, name: 'planner', labels: [label(shared, 'shared')] } },
          settingsVersion: 2,
          whilePluginUnavailable: null,
        },
    ]);
  });

  it('explained to argo, answers the ships the sender reaches now, read from the store', async () => {
    const explained = unwrap(await core.useCases.explainReach(argo, { fromShipId: planner.shipId }));

    expect(explained.reachableShipIds).toEqual([argo.shipId, vault.shipId]);
  });

  it('lets a ship answer the sender of a message it received', async () => {
    const asked = unwrap(await core.useCases.sendMessage(planner, aMessage(vault))).messageId;

    await expect(core.useCases.sendMessage(vault, aMessage(planner, asked))).resolves.toMatchObject({ isOk: true });
  });
});

describe('a send and a change of rules', () => {
  let networking: Crew;

  beforeEach(async () => {
    networking = await registeredPlugin();
    unwrap(await core.useCases.setNetworkRules(networking, { rules: [{ from: [shared], to: [sensitive] }] }));
  });

  it('take turns: a send that comes while a change is under way waits for it and is checked against the new version', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      networkSettings: {
        ...tx.networkSettings,
        findForUpdate: async (fleetId) => {
          const settings = await tx.networkSettings.findForUpdate(fleetId);
          await hold();
          return settings;
        },
      },
    }));
    const change = createSetNetworkRules({ uow, clock: core.clock, ids: newId })(networking, { rules: [] });
    await reached;

    const refused = await core.useCases.sendMessage(planner, aMessage(vault));

    expect(unwrap(await change)).toEqual({ version: 3 });
    expect(refusalOf(refused).kind).toBe('NOT_REACHABLE');
    await expect(core.prisma.reachRefusal.findMany({ select: { settingsVersion: true } })).resolves.toEqual([{ settingsVersion: 3 }]);
  });

  it('take turns: a change that comes while a send is under way waits for it, and the send goes through under the version it was checked against', async () => {
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      networkSettings: {
        ...tx.networkSettings,
        findForShare: async (fleetId) => {
          const settings = await tx.networkSettings.findForShare(fleetId);
          await hold();
          return settings;
        },
      },
    }));
    const send = createSendMessage({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher })(planner, aMessage(vault));
    await reached;

    const change = await core.useCases.setNetworkRules(networking, { rules: [] });

    expect(unwrap(await send).messageId).toMatch(/^msg_/);
    expect(unwrap(change)).toEqual({ version: 3 });
    const events = await core.prisma.event.findMany({ where: { type: { in: ['MessageAccepted', 'NetworkRulesSet'] } }, orderBy: { seq: 'asc' }, select: { type: true } });
    expect(events.map((event) => event.type)).toEqual(['NetworkRulesSet', 'MessageAccepted', 'NetworkRulesSet']);
  });

  it('racing, check every send against exactly one version: each one stored before the change, each one refused after it', async () => {
    const send = () => core.useCases.sendMessage(planner, aMessage(vault));
    const before = Array.from({ length: 6 }, send);
    const change = core.useCases.setNetworkRules(networking, { rules: [] });
    const sends = [...before, ...Array.from({ length: 6 }, send)];

    const results = await Promise.all(sends);
    unwrap(await change);

    const events = await core.prisma.event.findMany({ where: { type: { in: ['MessageAccepted', 'NetworkRulesSet'] } }, orderBy: { seq: 'asc' }, select: { type: true, details: true } });
    const changedAt = events.findIndex((event) => event.type === 'NetworkRulesSet' && JSON.stringify(event.details).includes('"version":3'));
    expect(events.slice(changedAt + 1).map((event) => event.type)).not.toContain('MessageAccepted');
    const refusals = await core.prisma.reachRefusal.findMany({ select: { settingsVersion: true } });
    // The sends started after the change queue behind it: the race has both sides.
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals.every((refusal) => refusal.settingsVersion === 3)).toBe(true);
    expect(results.filter((result) => result.isOk).length + refusals.length).toBe(sends.length);
    expect(results.filter((result) => !result.isOk).length).toBe(refusals.length);
  });
});

describe('a send to a type under network rules', () => {
  /** A crewed ship of type keeper, carrying the given trust value. */
  async function crewedKeeper(name: string, trust: LabelValueId): Promise<Crew> {
    const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'keeper' }));
    unwrap(await core.useCases.assignLabel(labeller, { shipId, valueId: trust }));
    const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
    return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
  }

  const toKeepers = { kind: 'type' as const, type: 'keeper' };

  let networking: Crew;

  beforeEach(async () => {
    networking = await registeredPlugin();
    unwrap(await core.useCases.setNetworkRules(networking, { rules: [{ from: [shared], to: [shared] }] }));
  });

  it('is claimed and counted only by a ship of the type the sender may reach, fixed at send time', async () => {
    const reachable = await crewedKeeper('keeper-a', shared);
    const unreachable = await crewedKeeper('keeper-b', sensitive);
    const { messageId } = unwrap(await core.useCases.sendMessage(planner, { ...aMessage(vault), selector: toKeepers }));

    await expect(core.prisma.delivery.findMany({ select: { reachableShipIds: true } })).resolves.toEqual([{ reachableShipIds: [reachable.shipId] }]);
    expect(unwrap(await core.useCases.checkInbox(unreachable, { waitSeconds: 0 }))).toEqual({ waiting: 0 });
    expect(unwrap(await core.useCases.checkInbox(reachable, { waitSeconds: 0 }))).toEqual({ waiting: 1 });
    expect(unwrap(await core.useCases.receiveDeliveries(reachable, { max: 10 })).deliveries.map((delivery) => delivery.messageId)).toEqual([messageId]);
  });

  it('is refused when the sender may reach no ship of the type, recording the type and each ship of it', async () => {
    const unreachable = await crewedKeeper('keeper-b', sensitive);

    refusalOf(await core.useCases.sendMessage(planner, { ...aMessage(vault), selector: toKeepers }));

    const [refusal] = unwrap(await core.useCases.readReachRefusals(argo));
    expect(refusal?.recipient).toEqual({
      kind: 'type',
      type: 'keeper',
      ships: [{ id: unreachable.shipId, name: 'keeper-b', labels: [{ labelId: trustId, key: 'trust', valueId: sensitive, value: 'sensitive' }] }],
    });
  });

  it("stays open to every ship of the type for argo's send: no ships kept", async () => {
    await crewedKeeper('keeper-b', sensitive);

    unwrap(await core.useCases.sendMessage(argo, { ...aMessage(vault), selector: toKeepers, model: undefined }));

    await expect(core.prisma.delivery.findMany({ select: { reachableShipIds: true } })).resolves.toEqual([{ reachableShipIds: [] }]);
  });
});
