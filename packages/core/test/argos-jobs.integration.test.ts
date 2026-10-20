import { createServer, type Server } from 'node:http';

import { ACCOUNT_TOKEN_HEADER, FLEET_HEADER, SCOPES, type FleetId, type Scope, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import type { AppRouter } from '../src/index.js';
import { createTestIssuer, type TestIssuer } from '../src/testing/account-token-issuer.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { secretOf } from '../src/testing/fleet.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { createTestClock } from './support/postgres-core.js';

// The jobs that were argo's alone, from HTTP to Postgres (decision 0053):
// each is a scope any actor holding it uses through the same call, a ship,
// an account or the installation, checked against its reach.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const clock = createTestClock('2026-10-20T10:00:00.000Z');

let keys: Server;
let issuer: TestIssuer;
let database: PrismaClient;
let useCases: UseCases;
let fleetServer: FastifyInstance;
let address: string;
let fleetId: FleetId;
let argo: ShipCaller;

function client(headers: Record<string, string>): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${address}/trpc`, headers })] });
}

/** An agent ship holding the scopes given, crewed: its client. */
async function anAgentHolding(scopes: readonly Scope[]): Promise<{ shipId: ShipId; calls: TRPCClient<AppRouter> }> {
  const commissioned = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: `agent-${newKey().slice(0, 8)}`, type: 'admin', scopes: [...scopes] }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId: commissioned.shipId, secret: secretOf(commissioned.secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return { shipId: commissioned.shipId, calls: client({ authorization: `Bearer ${crewToken}` }) };
}

/** An account with the scopes given, by a token pagasae signs now: its client. */
function anAccountHolding(scopes: readonly Scope[], account: { id?: string; personShipId?: ShipId } = {}): TRPCClient<AppRouter> {
  const { id = 'acc-mathilde', personShipId } = account;
  const now = Math.floor(clock.now().getTime() / 1000);
  const personShip = personShipId === undefined ? {} : { person_ship: personShipId };
  const token = issuer.sign({ iss: issuer.issuer, aud: fleetId, sub: id, org: 'org-acme', scope: scopes.join(' '), group: [], iat: now, exp: now + 600, ...personShip });
  return client({ [ACCOUNT_TOKEN_HEADER]: token });
}

function asInstallation(): TRPCClient<AppRouter> {
  return client({ 'x-aeolus-installation-token': INSTALLATION_TOKEN, [FLEET_HEADER]: fleetId });
}

async function refusalOf(call: Promise<unknown>): Promise<{ code: string | undefined; message: string }> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      const data: unknown = error.data;
      const code = typeof data === 'object' && data !== null && 'code' in data && typeof data.code === 'string' ? data.code : undefined;
      return { code, message: error.message };
    }
    throw error;
  }
  throw new Error('the call was not refused');
}

async function commissioned(name: string, kind?: 'person'): Promise<ShipId> {
  return unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: kind ?? 'keeper', ...(kind === undefined ? {} : { kind }) })).shipId;
}

async function ownerOf(shipId: ShipId): Promise<string | null | undefined> {
  return (await database.ship.findUnique({ where: { id: shipId }, select: { ownerShipId: true } }))?.ownerShipId;
}

async function lastEventAbout(shipId: ShipId, type: string) {
  return (await database.event.findMany({ where: { fleetId, type, shipId }, orderBy: { seq: 'desc' }, take: 1 }))[0];
}

beforeAll(async () => {
  keys = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(issuer.keySet()));
  });
  await new Promise<void>((listening) => keys.listen(0, '127.0.0.1', listening));
  const bound = keys.address();
  if (bound === null || typeof bound === 'string') {
    throw new Error('the key set server listens on no port');
  }
  issuer = createTestIssuer(`http://127.0.0.1:${String(bound.port)}`);

  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  fleetServer = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, clock, installationToken: INSTALLATION_TOKEN, accountTokenIssuer: issuer.issuer });
  address = await fleetServer.listen({ host: '127.0.0.1', port: 0 });

  const created = await client({ 'x-aeolus-installation-token': INSTALLATION_TOKEN }).installation.fleets.create.mutate({ requestId: newKey(), name: 'acme', operatorEmail: 'acme@example.com' });
  ({ fleetId } = created);
  argo = { shipId: created.operatorShipId, fleetId, kind: 'operator', scopes: [...SCOPES] };
});

afterAll(async () => {
  await fleetServer.close();
  await database.$disconnect();
  await new Promise((closed) => keys.close(closed));
});

describe('changing an owner (fleet:owner)', () => {
  it('is done by an agent ship holding fleet:owner, the event naming it', async () => {
    const admin = await anAgentHolding(['fleet:owner']);
    const scout = await commissioned('scout-owned-by-agent');
    const thomas = await commissioned('thomas-for-agent', 'person');

    await admin.calls.fleet.setOwner.mutate({ shipId: scout, ownerShipId: thomas });

    await expect(ownerOf(scout)).resolves.toBe(thomas);
    await expect(lastEventAbout(scout, 'OwnerChanged')).resolves.toMatchObject({ actorKind: 'ship', actorShipId: admin.shipId });
  });

  it('is done by an account holding fleet:owner, the event naming the account', async () => {
    const scout = await commissioned('scout-owned-by-account');
    const thomas = await commissioned('thomas-for-account', 'person');

    await anAccountHolding(['fleet:owner']).fleet.setOwner.mutate({ shipId: scout, ownerShipId: thomas });

    await expect(ownerOf(scout)).resolves.toBe(thomas);
    await expect(lastEventAbout(scout, 'OwnerChanged')).resolves.toMatchObject({ actorKind: 'account', actorAccountId: 'acc-mathilde' });
  });

  it('is refused to a ship without fleet:owner', async () => {
    const manager = await anAgentHolding(['fleet:manage']);
    const scout = await commissioned('scout-kept');

    await expect(refusalOf(manager.calls.fleet.setOwner.mutate({ shipId: scout, ownerShipId: argo.shipId }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the fleet:owner scope',
    });
  });

  it('is refused to the installation, which does not hold fleet:owner', async () => {
    const scout = await commissioned('scout-not-the-installations');

    await expect(refusalOf(asInstallation().fleet.setOwner.mutate({ shipId: scout, ownerShipId: argo.shipId }))).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('connecting a plugin (fleet:connect)', () => {
  it('is done by an agent ship holding fleet:connect, the event naming it', async () => {
    const connector = await anAgentHolding(['fleet:connect']);
    const plugin = await anAgentHolding([]);

    await connector.calls.fleet.connectPlugin.mutate({ shipId: plugin.shipId });

    await expect(lastEventAbout(plugin.shipId, 'PluginConnected')).resolves.toMatchObject({ actorKind: 'ship', actorShipId: connector.shipId });
  });

  it('is refused to a ship without fleet:connect', async () => {
    const manager = await anAgentHolding(['fleet:manage']);
    const plugin = await anAgentHolding([]);

    await expect(refusalOf(manager.calls.fleet.connectPlugin.mutate({ shipId: plugin.shipId }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the fleet:connect scope',
    });
  });
});

describe('explaining reach and reading refusals (fleet:explain)', () => {
  it('is done by an agent ship holding fleet:explain', async () => {
    const explainer = await anAgentHolding(['fleet:explain']);
    const scout = await commissioned('scout-explained');

    const explained = await explainer.calls.fleet.explainReach.query({ fromShipId: scout, toShipId: argo.shipId });

    expect(explained.send.map(({ shipId }) => shipId)).toEqual([argo.shipId]);
    await expect(explainer.calls.fleet.reachRefusals.query()).resolves.toBeDefined();
  });

  it('is done by an account holding fleet:explain', async () => {
    const scout = await commissioned('scout-explained-to-account');

    await expect(anAccountHolding(['fleet:explain']).fleet.explainReach.query({ fromShipId: scout })).resolves.toBeDefined();
    await expect(anAccountHolding(['fleet:explain']).fleet.reachRefusals.query()).resolves.toBeDefined();
  });

  it('is refused to a ship without fleet:explain, even one with fleet:read', async () => {
    const reader = await anAgentHolding(['fleet:read']);

    await expect(refusalOf(reader.calls.fleet.reachRefusals.query())).resolves.toEqual({ code: 'FORBIDDEN', message: 'This call needs the fleet:explain scope' });
    await expect(refusalOf(reader.calls.fleet.explainReach.query({ fromShipId: argo.shipId }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the fleet:explain scope',
    });
  });
});

describe("turning the viewer's reading off (fleet:network)", () => {
  it('is done by an account holding fleet:network', async () => {
    await anAccountHolding(['fleet:network']).fleet.setBuiltInRule.mutate({ rule: 'viewerRead', isOn: false });

    await expect(database.event.findMany({ where: { fleetId, type: 'BuiltInRuleChanged' }, orderBy: { seq: 'desc' }, take: 1 })).resolves.toMatchObject([
      { actorKind: 'account', details: { rule: 'viewerRead', isOn: false } },
    ]);
  });
});

describe('granting scopes on a live ship (scopes:grant)', () => {
  it('is done by an account holding scopes:grant and the scope it grants, the event naming it', async () => {
    const scout = await anAgentHolding([]);

    await anAccountHolding(['scopes:grant', 'fleet:read']).fleet.grantScopes.mutate({ shipId: scout.shipId, grant: ['fleet:read'], revoke: [] });

    await expect(lastEventAbout(scout.shipId, 'ScopesChanged')).resolves.toMatchObject({ actorKind: 'account', details: { added: 'fleet:read' } });
  });
});

describe('the label group, which the installation defines and owns (decisions 0031, 0052)', () => {
  it('is defined, listed with the installation as its owner, changed and deleted by the installation', async () => {
    const { labelId } = await asInstallation().fleet.defineLabel.mutate({ key: 'group-to-delete', values: ['sales'] });

    const listed = await anAccountHolding(['fleet:read']).fleet.labels.query();
    expect(listed.find((label) => label.id === labelId)?.owner).toEqual({ kind: 'installation' });
    await asInstallation().fleet.changeLabelValues.mutate({ labelId, values: ['sales', 'finance'] });
    await asInstallation().fleet.deleteLabel.mutate({ labelId });
    await expect(database.label.count({ where: { id: labelId } })).resolves.toBe(0);
  });

  it('is refused to an account', async () => {
    await expect(refusalOf(anAccountHolding(['labels:define']).fleet.defineLabel.mutate({ key: 'team', values: ['a'] }))).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('assigning values of any label (labels:any)', () => {
  it('lets the installation give a person ship values of its group label, and take them off again', async () => {
    const { values } = await asInstallation().fleet.defineLabel.mutate({ key: 'group', values: ['sales', 'finance'] });
    const sales = values.find((value) => value.value === 'sales')?.id ?? values[0]?.id;
    const burak = await commissioned('burak-in-sales', 'person');
    if (sales === undefined) {
      throw new Error('the group label has no values');
    }

    await asInstallation().fleet.assignLabel.mutate({ shipId: burak, valueId: sales });
    await expect(database.shipLabel.count({ where: { shipId: burak, valueId: sales } })).resolves.toBe(1);
    await asInstallation().fleet.unassignLabel.mutate({ shipId: burak, valueId: sales });
    await expect(database.shipLabel.count({ where: { shipId: burak } })).resolves.toBe(0);
  });

  it("lets an agent ship holding labels:any give a ship another owner's value", async () => {
    const labeller = await anAgentHolding(['labels:assign', 'labels:any']);
    const { values } = unwrap(await useCases.defineLabel(argo, { key: 'tier', values: ['gold'] }));
    const scout = await commissioned('scout-in-gold');
    const [gold] = values;
    if (gold === undefined) {
      throw new Error('the tier label has no values');
    }

    await labeller.calls.fleet.assignLabel.mutate({ shipId: scout, valueId: gold.id });

    await expect(lastEventAbout(scout, 'LabelAssigned')).resolves.toMatchObject({ actorKind: 'ship', actorShipId: labeller.shipId });
  });
});

describe('the network rule the installation declares on its group label (decisions 0037, 0052)', () => {
  it('is kept, read by the networking plugin with the installation as its declarer, and withdrawn with none', async () => {
    const { labelId } = await asInstallation().fleet.defineLabel.mutate({ key: 'group-ruled', values: ['sales'] });
    const sameGroup = { labelId, value: '#' };
    const rules = [{ verb: 'send' as const, from: [sameGroup], to: [sameGroup] }];
    const networking = await anAgentHolding(['fleet:network']);

    await expect(asInstallation().fleet.declareNetworkRules.mutate({ rules })).resolves.toEqual({ rules: 1 });
    await expect(networking.calls.fleet.declaredNetworkRules.query()).resolves.toContainEqual({ declarer: { kind: 'installation' }, rules });
    await expect(database.installationDeclaredNetworkRules.count({ where: { fleetId } })).resolves.toBe(1);
    await asInstallation().fleet.declareNetworkRules.mutate({ rules: [] });
    await expect(database.installationDeclaredNetworkRules.count({ where: { fleetId } })).resolves.toBe(0);
  });

  it('is read by an account holding fleet:network, as by the networking plugin', async () => {
    const { labelId } = await asInstallation().fleet.defineLabel.mutate({ key: 'group-read', values: ['sales'] });
    const sameGroup = { labelId, value: '#' };
    const rules = [{ verb: 'send' as const, from: [sameGroup], to: [sameGroup] }];
    await asInstallation().fleet.declareNetworkRules.mutate({ rules });

    await expect(anAccountHolding(['fleet:network']).fleet.declaredNetworkRules.query()).resolves.toContainEqual({ declarer: { kind: 'installation' }, rules });
    await asInstallation().fleet.declareNetworkRules.mutate({ rules: [] });
  });

  it('writes NetworkRulesDeclared naming the installation', async () => {
    const { labelId } = await asInstallation().fleet.defineLabel.mutate({ key: 'group-announced', values: ['sales'] });
    const sameGroup = { labelId, value: '#' };

    await asInstallation().fleet.declareNetworkRules.mutate({ rules: [{ verb: 'send', from: [sameGroup], to: [sameGroup] }] });

    const [declared] = await database.event.findMany({ where: { fleetId, type: 'NetworkRulesDeclared' }, orderBy: { seq: 'desc' }, take: 1 });
    expect(declared).toMatchObject({ actorKind: 'installation', shipId: null, details: { rules: 1 } });
    await asInstallation().fleet.declareNetworkRules.mutate({ rules: [] });
  });

  it('is refused to an account, which owns no label', async () => {
    const { labelId } = await asInstallation().fleet.defineLabel.mutate({ key: 'group-guarded', values: ['sales'] });
    const sameGroup = { labelId, value: '#' };

    await expect(refusalOf(anAccountHolding(['labels:define']).fleet.declareNetworkRules.mutate({ rules: [{ verb: 'send', from: [sameGroup], to: [sameGroup] }] }))).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('a person ship the installation commissions for an account (decisions 0052, 0053)', () => {
  const personShipFor = (account: string) => ({ name: `person-${account.slice(0, 12)}`, type: 'person', kind: 'person' as const, scopes: ['messages:send' as const, 'messages:receive' as const] });

  it('owns itself, is kept as commissioned by the installation, and a retry under the same key answers the same ship', async () => {
    const commissioned = await asInstallation().fleet.commission.mutate({ ...personShipFor('acc-01thomas0000'), idempotencyKey: 'person-acc-01thomas0000' });

    const again = await asInstallation().fleet.commission.mutate({ ...personShipFor('acc-01thomas0000'), idempotencyKey: 'person-acc-01thomas0000' });

    expect(again).toMatchObject({ shipId: commissioned.shipId, secret: null });
    await expect(database.ship.findUnique({ where: { id: commissioned.shipId }, select: { kind: true, ownerShipId: true, commissionedByKind: true } })).resolves.toEqual({
      kind: 'person',
      ownerShipId: commissioned.shipId,
      commissionedByKind: 'installation',
    });
  });

  it('is released by the installation once crewed', async () => {
    const commissioned = await asInstallation().fleet.commission.mutate({ ...personShipFor('acc-01burak00000'), idempotencyKey: 'person-acc-01burak00000' });
    unwrap(await useCases.claimShip({ shipId: commissioned.shipId, secret: secretOf(commissioned.secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));

    await asInstallation().fleet.release.mutate({ shipId: commissioned.shipId });

    await expect(lastEventAbout(commissioned.shipId, 'LeaseRevoked')).resolves.toMatchObject({ actorKind: 'installation' });
  });

  it('lets the account commission an agent ship its person ship owns', async () => {
    const person = await asInstallation().fleet.commission.mutate({ ...personShipFor('acc-01charlotte'), idempotencyKey: 'person-acc-01charlotte' });

    const helper = await anAccountHolding(['fleet:commission'], { id: 'acc-01charlotte', personShipId: person.shipId }).fleet.commission.mutate({ name: 'charlottes-helper', type: 'helper', idempotencyKey: newKey() });

    await expect(ownerOf(helper.shipId)).resolves.toBe(person.shipId);
    await expect(database.ship.findUnique({ where: { id: helper.shipId }, select: { commissionedBy: true, commissionedByKind: true } })).resolves.toEqual({ commissionedBy: 'acc-01charlotte', commissionedByKind: 'account' });
  });

  it('refuses the installation an agent ship, as it does not hold fleet:commission', async () => {
    await expect(refusalOf(asInstallation().fleet.commission.mutate({ name: 'not-a-person', type: 'helper', idempotencyKey: newKey() }))).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('the group values of a person ship, given at its commission (decisions 0052, 0053)', () => {
  it('are carried by the person ship from its commission', async () => {
    const { values } = await asInstallation().fleet.defineLabel.mutate({ key: 'group-given', values: ['sales'] });
    const sales = values.map((each) => each.id);

    const person = await asInstallation().fleet.commission.mutate({ name: 'person-acc-01dana000', type: 'person', kind: 'person', valueIds: sales, idempotencyKey: 'person-acc-01dana000' });

    await expect(database.shipLabel.findMany({ where: { shipId: person.shipId }, select: { valueId: true } })).resolves.toEqual(sales.map((valueId) => ({ valueId })));
  });
});

describe('the person ship of an account that has none, commissioned with its first ship (decisions 0052, 0057)', () => {
  it("is commissioned with the account's first ship, which it owns, and the installation's commission under its key answers it", async () => {
    const helper = await anAccountHolding(['fleet:commission'], { id: 'acc-01emma00000-x' }).fleet.commission.mutate({ name: 'emmas-helper', type: 'helper', idempotencyKey: newKey() });

    const person = await asInstallation().fleet.commission.mutate({ name: 'person-acc-01emma00', type: 'person', kind: 'person', idempotencyKey: 'person-acc-01emma00000-x' });

    expect(person.secret).toBeNull();
    await expect(ownerOf(helper.shipId)).resolves.toBe(person.shipId);
    await expect(database.ship.findUnique({ where: { id: person.shipId }, select: { name: true, ownerShipId: true, commissionedByKind: true } })).resolves.toEqual({
      name: 'person-acc-01emma00',
      ownerShipId: person.shipId,
      commissionedByKind: 'installation',
    });
  });
});
