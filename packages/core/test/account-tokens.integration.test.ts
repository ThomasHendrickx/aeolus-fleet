import { createServer, type Server } from 'node:http';

import { ACCOUNT_TOKEN_HEADER, FLEET_HEADER, SCOPES, type FleetId, type LabelValueId, type ShipId } from '@aeolus-fleet/common';
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

// Account tokens and the installation as actors, from HTTP to Postgres
// (decisions 0057, 0058): core checks pagasae's signature, the fleet, the end
// and a cut-off on every call, then authorises the account by its scopes and
// reach as it does a ship, and every event names it by its id only. The
// installation acts in a fleet through the same calls. The fleet defines
// `group` (engineering, finance); near carries group engineering, far group
// finance; the rules let group engineering manage group engineering, with
// open off for manage.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const MINUTE_MS = 60_000;
const clock = createTestClock('2026-10-19T10:00:00.000Z');

let keys: Server;
let issuer: TestIssuer;
let database: PrismaClient;
let useCases: UseCases;
let fleetServer: FastifyInstance;
let address: string;
let fleetId: FleetId;
let otherFleetId: FleetId;
let argo: ShipCaller;
let near: ShipId;
let far: ShipId;
let gateway: { shipId: ShipId; crewToken: string };

function seconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}

/** The claims of a token pagasae signs for Mathilde in the fleet now, for 10 minutes. */
function mathilde(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = seconds(clock.now());
  return { iss: issuer.issuer, aud: fleetId, sub: 'acc-mathilde', org: 'org-acme', scope: 'fleet:read fleet:manage', group: ['engineering'], iat: now, exp: now + 600, ...overrides };
}

function client(headers: Record<string, string>): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${address}/trpc`, headers })] });
}

function asAccount(token: string, crewToken?: string): TRPCClient<AppRouter> {
  return client({ [ACCOUNT_TOKEN_HEADER]: token, ...(crewToken === undefined ? {} : { authorization: `Bearer ${crewToken}` }) });
}

function asInstallation(fleet: FleetId): TRPCClient<AppRouter> {
  return client({ 'x-aeolus-installation-token': INSTALLATION_TOKEN, [FLEET_HEADER]: fleet });
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

  const installation = client({ 'x-aeolus-installation-token': INSTALLATION_TOKEN }).installation;
  const created = await installation.fleets.create.mutate({ requestId: newKey(), name: 'acme', operatorEmail: 'acme@example.com' });
  ({ fleetId } = created);
  ({ fleetId: otherFleetId } = await installation.fleets.create.mutate({ requestId: newKey(), name: 'globex', operatorEmail: 'globex@example.com' }));
  argo = { shipId: created.operatorShipId, fleetId, kind: 'operator', scopes: [...SCOPES] };

  const networking = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'networking', type: 'networking', scopes: ['fleet:network'] }));
  const { crewToken: networkingToken } = unwrap(await useCases.claimShip({ shipId: networking.shipId, secret: secretOf(networking.secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  const plugin = unwrap(await useCases.authenticate.byCrewToken(networkingToken));
  const group = unwrap(await useCases.defineLabel(argo, { key: 'group', values: ['engineering', 'finance'] }));
  const valueOf = (value: string): LabelValueId => {
    const held = group.values.find((candidate) => candidate.value === value);
    if (held === undefined) {
      throw new Error(`the label group has no value ${value}`);
    }
    return held.id;
  };
  near = await commissioned('near');
  far = await commissioned('far');
  unwrap(await useCases.assignLabel(argo, { shipId: near, valueId: valueOf('engineering') }));
  unwrap(await useCases.assignLabel(argo, { shipId: far, valueId: valueOf('finance') }));
  const { savedAgainstVersion } = unwrap(await useCases.saveNetworkRulesDraft(plugin, { rules: [{ verb: 'manage', from: [valueOf('engineering')], to: [valueOf('engineering')] }, { verb: 'send', from: [], to: [] }, { verb: 'read', from: [], to: [] }] }));
  unwrap(await useCases.applyNetworkRules(plugin, { version: savedAgainstVersion }));

  const gatewayShip = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'gateway', type: 'gateway', kind: 'app' }));
  gateway = {
    shipId: gatewayShip.shipId,
    crewToken: unwrap(await useCases.claimShip({ shipId: gatewayShip.shipId, secret: secretOf(gatewayShip.secret), location: { kind: 'CLOUD' }, harness: 'gateway' })).crewToken,
  };
});

afterAll(async () => {
  await fleetServer.close();
  await database.$disconnect();
  await new Promise((closed) => keys.close(closed));
});

describe('a call with an account token', () => {
  it('reads the fleet with the scopes the token carries', async () => {
    const ships = await asAccount(issuer.sign(mathilde())).fleet.list.query();

    expect(ships.map((ship) => ship.name)).toContain('near');
  });

  it('manages a ship its group values reach, the event naming the account by its id only', async () => {
    await asAccount(issuer.sign(mathilde())).fleet.rename.mutate({ shipId: near, name: 'nearer' });

    const [renamed] = await database.event.findMany({ where: { fleetId, type: 'ShipRenamed', shipId: near } });
    expect(renamed).toMatchObject({ actorKind: 'account', actorAccountId: 'acc-mathilde', actorShipId: null, actorThroughShipId: null });
    expect(JSON.stringify(renamed, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))).not.toContain('@');
  });

  it('names the ship that presented the token in the event', async () => {
    await asAccount(issuer.sign(mathilde()), gateway.crewToken).fleet.rename.mutate({ shipId: near, name: 'near' });

    const renamed = await database.event.findMany({ where: { fleetId, type: 'ShipRenamed', shipId: near }, orderBy: { seq: 'desc' }, take: 1 });
    expect(renamed[0]).toMatchObject({ actorKind: 'account', actorAccountId: 'acc-mathilde', actorThroughShipId: gateway.shipId });
  });

  it('follows the fleet, each event naming its actor', async () => {
    const { events } = await asAccount(issuer.sign(mathilde())).fleet.follow.query({ afterSeq: 0, max: 100 });

    expect(events.filter((event) => event.type === 'ShipRenamed').map(({ actorKind, actorAccountId }) => ({ actorKind, actorAccountId }))).toContainEqual({
      actorKind: 'account',
      actorAccountId: 'acc-mathilde',
    });
  });

  it('is refused a ship no rule lets it reach, as a ship is', async () => {
    await expect(refusalOf(asAccount(issuer.sign(mathilde())).fleet.rename.mutate({ shipId: far, name: 'renamed' }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'The network rules do not allow this manage',
    });
  });

  it('is refused a call whose scope its token does not carry', async () => {
    await expect(refusalOf(asAccount(issuer.sign(mathilde({ scope: 'fleet:read' }))).fleet.rename.mutate({ shipId: near, name: 'renamed' }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the fleet:manage scope',
    });
  });

  it('is refused a call that stores something on the calling ship: only a ship makes it', async () => {
    const token = issuer.sign(mathilde({ scope: 'labels:define' }));

    await expect(refusalOf(asAccount(token).fleet.defineLabel.mutate({ key: 'team', values: ['a'] }))).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('is no crew: a ship procedure refuses it', async () => {
    await expect(refusalOf(asAccount(issuer.sign(mathilde())).ship.whoami.query())).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe("an account token and its own person ship (decision 0052)", () => {
  it('gets a starting prompt for it with fleet:read alone, presented by the gateway, the event naming the account through it', async () => {
    const personShip = await commissioned('person-mathilde', 'person');

    const { shipId, secret } = await asAccount(issuer.sign(mathilde({ scope: 'fleet:read', person_ship: personShip })), gateway.crewToken).fleet.getStartingPrompt.mutate({ shipId: personShip });

    expect({ shipId, hasSecret: secret.length > 0 }).toEqual({ shipId: personShip, hasSecret: true });
    const issued = await database.event.findMany({ where: { fleetId, type: 'StartingPromptIssued', shipId: personShip }, orderBy: { seq: 'desc' }, take: 1 });
    expect(issued[0]).toMatchObject({ actorKind: 'account', actorAccountId: 'acc-mathilde', actorThroughShipId: gateway.shipId });
  });

  it('releases it with fleet:read alone, so the gateway can crew it again', async () => {
    const personShip = await commissioned('person-mathilde-crewed', 'person');
    const prompt = unwrap(await useCases.getStartingPrompt(argo, { shipId: personShip }));
    unwrap(await useCases.claimShip({ shipId: personShip, secret: secretOf(prompt.secret), location: { kind: 'CLOUD' }, harness: 'gateway' }));

    await asAccount(issuer.sign(mathilde({ scope: 'fleet:read', person_ship: personShip })), gateway.crewToken).fleet.release.mutate({ shipId: personShip });

    expect((await useCases.listFleet(argo)).find((ship) => ship.id === personShip)).toMatchObject({ status: 'awaitingCrew' });
  });

  it('is refused a starting prompt for a ship not its person ship', async () => {
    const personShip = await commissioned('person-mathilde-other', 'person');

    await expect(refusalOf(asAccount(issuer.sign(mathilde({ scope: 'fleet:read', person_ship: personShip }))).fleet.getStartingPrompt.mutate({ shipId: far }))).resolves.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('is refused a starting prompt without a person ship, saying which scope it needs', async () => {
    await expect(refusalOf(asAccount(issuer.sign(mathilde({ scope: 'fleet:read' }))).fleet.getStartingPrompt.mutate({ shipId: far }))).resolves.toEqual({
      code: 'FORBIDDEN',
      message: 'This call needs the fleet:manage or crew:run scope',
    });
  });
});

describe('an account token core refuses', () => {
  it('refuses one that ended more than 30 seconds ago, saying so', async () => {
    const now = seconds(clock.now());

    await expect(refusalOf(asAccount(issuer.sign(mathilde({ iat: now - 631, exp: now - 31 }))).fleet.list.query())).resolves.toEqual({
      code: 'UNAUTHORIZED',
      message: 'This account token has ended; present a fresh one',
    });
  });

  it('refuses one for another fleet', async () => {
    await expect(refusalOf(asAccount(issuer.sign(mathilde({ aud: otherFleetId })), gateway.crewToken).fleet.list.query())).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses one signed with a key pagasae never published', async () => {
    await expect(refusalOf(asAccount(issuer.signWithUnpublishedKey(mathilde())).fleet.list.query())).resolves.toEqual({
      code: 'UNAUTHORIZED',
      message: 'Present an account token pagasae signed for this fleet',
    });
  });

  it('refuses one that names another issuer', async () => {
    await expect(refusalOf(asAccount(issuer.sign(mathilde({ iss: 'https://pagasae.example' }))).fleet.list.query())).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses a cut-off account its tokens issued before the cut-off, in every fleet, and takes one issued after it', async () => {
    const burak = (overrides: Record<string, unknown> = {}) => mathilde({ sub: 'acc-burak', ...overrides });
    const before = issuer.sign(burak());
    const beforeElsewhere = issuer.sign(burak({ aud: otherFleetId }));
    clock.advance(1000);

    await client({ 'x-aeolus-installation-token': INSTALLATION_TOKEN }).installation.accounts.cutOff.mutate({ accountId: 'acc-burak' });
    clock.advance(1000);

    await expect(refusalOf(asAccount(before).fleet.list.query())).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(refusalOf(asAccount(beforeElsewhere).fleet.list.query())).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(asAccount(issuer.sign(burak())).fleet.list.query()).resolves.toBeDefined();
  });

  it('takes a token signed with a key pagasae published after core fetched its keys, a minute later', async () => {
    await asAccount(issuer.sign(mathilde())).fleet.list.query();
    issuer.rotate();
    clock.advance(MINUTE_MS);

    await expect(asAccount(issuer.sign(mathilde())).fleet.list.query()).resolves.toBeDefined();
  });

  it('accepts none where no issuer is configured', async () => {
    const databaseUrl = await createMigratedDatabase();
    const withoutPagasae = createApp({ databaseUrl, publicUrl: FLEET_URL, logger: false, clock, installationToken: INSTALLATION_TOKEN });
    const at = await withoutPagasae.listen({ host: '127.0.0.1', port: 0 });
    try {
      const installation = createTRPCClient<AppRouter>({ links: [httpLink({ url: `${at}/trpc`, headers: { 'x-aeolus-installation-token': INSTALLATION_TOKEN } })] }).installation;
      const { fleetId: selfHosted } = await installation.fleets.create.mutate({ requestId: newKey(), name: 'home', operatorEmail: 'home@example.com' });
      const token = issuer.sign(mathilde({ aud: selfHosted }));

      await expect(refusalOf(createTRPCClient<AppRouter>({ links: [httpLink({ url: `${at}/trpc`, headers: { [ACCOUNT_TOKEN_HEADER]: token } })] }).fleet.list.query())).resolves.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    } finally {
      await withoutPagasae.close();
    }
  });
});

describe('the installation acting in a fleet', () => {
  it('releases a person ship by its built-in rule, the event naming the installation', async () => {
    const burak = await commissioned('burak', 'person');

    await asInstallation(fleetId).fleet.rename.mutate({ shipId: burak, name: 'burak-left' });

    const [renamed] = await database.event.findMany({ where: { fleetId, type: 'ShipRenamed', shipId: burak } });
    expect(renamed).toMatchObject({ actorKind: 'installation', actorShipId: null, actorAccountId: null });
  });

  it("reads each ship's owner in the fleet list, so pagasae keeps a person ship while it owns ships: none for argo (#983)", async () => {
    const ships = await asInstallation(fleetId).fleet.list.query();

    expect(ships.filter((ship) => ship.name === 'argo' || ship.name === 'near').map((ship) => ({ name: ship.name, ownerShipId: 'ownerShipId' in ship ? ship.ownerShipId : 'outside read reach' }))).toEqual([
      { name: 'argo', ownerShipId: null },
      { name: 'near', ownerShipId: argo.shipId },
    ]);
  });

  it('is refused a call whose scope it does not hold there', async () => {
    await expect(refusalOf(asInstallation(fleetId).fleet.setOwner.mutate({ shipId: near, ownerShipId: near }))).resolves.toEqual({ code: 'FORBIDDEN', message: 'This call needs the fleet:owner scope' });
  });

  it('is refused with a wrong installation token', async () => {
    const wrong = client({ 'x-aeolus-installation-token': `${INSTALLATION_TOKEN}x`, [FLEET_HEADER]: fleetId });

    await expect(refusalOf(wrong.fleet.rename.mutate({ shipId: near, name: 'renamed' }))).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('is refused in a fleet it does not host', async () => {
    await expect(refusalOf(asInstallation('flt_00000000000000000000000000').fleet.rename.mutate({ shipId: near, name: 'renamed' }))).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });
});
