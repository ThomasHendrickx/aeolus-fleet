import { createIdGenerator, type LabelValueId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { createSendMessage } from '../src/domain/messaging/send-message.js';
import { createSetNetworkRules } from '../src/domain/registry/set-network-rules.js';
import type { Caller } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller, SESSION_MODEL } from './support/core-fixtures.js';
import { newKey } from './support/keys.js';
import { createPostgresCore, heldUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { refusalOf, unwrap } from './support/result.js';

// The fleet's network rules on a real Postgres (decision 0033): the settings
// kept with their version; a refused send stores nothing but its record, in
// the transaction that refuses it; an answer found by its message's delivery;
// and a send and a change of rules taking turns on the settings, so every
// send is checked against exactly one version.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: Caller;
let planner: Caller;
let vault: Caller;
let shared: LabelValueId;
let sensitive: LabelValueId;

async function aShip(name: string): Promise<Caller> {
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: name }));
  return { fleetId: argo.fleetId, shipId, kind: 'agent', scopes: ['messages:send', 'messages:receive'] };
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
  const labeller: Caller = { fleetId: argo.fleetId, shipId: labellerId, kind: 'agent', scopes: ['labels:define', 'labels:assign'] };
  planner = await aShip('planner');
  vault = await aShip('vault');
  const trust = unwrap(await core.useCases.defineLabel(labeller, { key: 'trust', values: ['shared', 'sensitive'] }));
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
  it('keep the rules a set gave, at a version that moves on every set', async () => {
    unwrap(await core.useCases.setNetworkRules(argo, { rules: [{ from: [shared], to: [] }] }));
    const rules = [{ from: [shared, sensitive], to: [sensitive] }, { from: [], to: [] }];

    expect(unwrap(await core.useCases.setNetworkRules(argo, { rules }))).toEqual({ version: 2 });
    await expect(core.prisma.networkSettings.findMany({ select: { fleetId: true, rules: true, version: true } })).resolves.toEqual([
      { fleetId: argo.fleetId, rules, version: 2 },
    ]);
  });

  it('keep none once cleared, at the next version', async () => {
    unwrap(await core.useCases.setNetworkRules(argo, { rules: [] }));

    expect(unwrap(await core.useCases.setNetworkRules(argo, { rules: null }))).toEqual({ version: 2 });
    await expect(core.prisma.networkSettings.findMany({ select: { rules: true, version: true } })).resolves.toEqual([{ rules: null, version: 2 }]);
  });

  it('write NetworkRulesSet with the change, in the same transaction', async () => {
    unwrap(await core.useCases.setNetworkRules(argo, { rules: [] }));

    await expect(core.prisma.event.findMany({ where: { type: 'NetworkRulesSet' }, select: { details: true } })).resolves.toEqual([{ details: { version: 1, rules: 0 } }]);
  });
});

describe('a send under network rules', () => {
  beforeEach(async () => {
    unwrap(await core.useCases.setNetworkRules(argo, { rules: [{ from: [shared], to: [sensitive] }] }));
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
    const label = (valueId: LabelValueId, value: string) => ({ labelId: expect.stringMatching(/^lbl_/), key: 'trust', valueId, value });

    await expect(core.useCases.readReachRefusals(argo)).resolves.toEqual({
      isOk: true,
      value: [
        {
          fleetId: argo.fleetId,
          id: expect.stringMatching(/^rfs_/),
          at: core.clock.now(),
          sender: { id: vault.shipId, name: 'vault', labels: [label(sensitive, 'sensitive')] },
          recipient: { kind: 'ship', ship: { id: planner.shipId, name: 'planner', labels: [label(shared, 'shared')] } },
          settingsVersion: 1,
        },
      ],
    });
  });

  it('lets a ship answer the sender of a message it received', async () => {
    const asked = unwrap(await core.useCases.sendMessage(planner, aMessage(vault))).messageId;

    await expect(core.useCases.sendMessage(vault, aMessage(planner, asked))).resolves.toMatchObject({ isOk: true });
  });
});

describe('a send and a change of rules', () => {
  beforeEach(async () => {
    unwrap(await core.useCases.setNetworkRules(argo, { rules: [{ from: [shared], to: [sensitive] }] }));
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
    const change = createSetNetworkRules({ uow, clock: core.clock, ids: newId })(argo, { rules: [] });
    await reached;

    const refused = await core.useCases.sendMessage(planner, aMessage(vault));

    expect(unwrap(await change)).toEqual({ version: 2 });
    expect(refusalOf(refused).kind).toBe('NOT_REACHABLE');
    await expect(core.prisma.reachRefusal.findMany({ select: { settingsVersion: true } })).resolves.toEqual([{ settingsVersion: 2 }]);
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

    const change = await core.useCases.setNetworkRules(argo, { rules: [] });

    expect(unwrap(await send).messageId).toMatch(/^msg_/);
    expect(unwrap(change)).toEqual({ version: 2 });
    const events = await core.prisma.event.findMany({ where: { type: { in: ['MessageAccepted', 'NetworkRulesSet'] } }, orderBy: { seq: 'asc' }, select: { type: true } });
    expect(events.map((event) => event.type)).toEqual(['NetworkRulesSet', 'MessageAccepted', 'NetworkRulesSet']);
  });

  it('racing, check every send against exactly one version: each one stored before the change, each one refused after it', async () => {
    const sends = Array.from({ length: 12 }, () => core.useCases.sendMessage(planner, aMessage(vault)));
    const change = core.useCases.setNetworkRules(argo, { rules: [] });

    const results = await Promise.all(sends);
    unwrap(await change);

    const events = await core.prisma.event.findMany({ where: { type: { in: ['MessageAccepted', 'NetworkRulesSet'] } }, orderBy: { seq: 'asc' }, select: { type: true, details: true } });
    const changedAt = events.findIndex((event) => event.type === 'NetworkRulesSet' && JSON.stringify(event.details).includes('"version":2'));
    expect(events.slice(changedAt + 1).map((event) => event.type)).not.toContain('MessageAccepted');
    const refusals = await core.prisma.reachRefusal.findMany({ select: { settingsVersion: true } });
    expect(refusals.every((refusal) => refusal.settingsVersion === 2)).toBe(true);
    expect(results.filter((result) => result.isOk).length + refusals.length).toBe(sends.length);
    expect(results.filter((result) => !result.isOk).length).toBe(refusals.length);
  });
});
