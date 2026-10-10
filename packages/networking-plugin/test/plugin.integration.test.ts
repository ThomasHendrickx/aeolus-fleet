import type { ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../core/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../core/src/adapters/prisma/client.js';
import { createUseCases } from '../../core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../../core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../core/test/support/database.js';
import { newKey } from '../../core/test/support/keys.js';
import { unwrap } from '../../core/test/support/result.js';
import { createNetworkingPluginApp, type NetworkingPluginApp } from '../src/app.js';
import { connectPlugin, mutate, query, signIn } from './support/connection.js';
import { createPluginDatabase } from './support/database.js';

// The networking plugin against a real fleet: it starts not connected, with no
// secret anywhere; the operator connects it as its ship (fleet:read,
// fleet:network), keeps the crew token in its own database and is connected
// again after a restart.

/** How long the test fleet holds a receive open: short, so the receiving process stops quickly. */
const RECEIVE_WAIT_MS = 500;

let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let pluginDatabaseUrl: string;
let useCases: ReturnType<typeof createUseCases>;
let argo: ReturnType<typeof operatorCaller>;
let shipId: ShipId;
let secret: string;
let cookie: string;
const apps: NetworkingPluginApp[] = [];

beforeEach(async () => {
  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  useCases = createUseCases({ prisma: fleetDatabase });
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const commissioned = unwrap(
    await useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name: 'networking-plugin',
      type: 'networking-plugin',
      fleetScopes: ['fleet:read', 'fleet:network'],
    }),
  );
  shipId = commissioned.shipId;
  secret = secretOf(commissioned.secret);
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: RECEIVE_WAIT_MS });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });
  cookie = await signIn(fleetUrl);
  pluginDatabaseUrl = await createPluginDatabase();
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await fleet.close();
  await fleetDatabase.$disconnect();
});

/** A networking plugin process on the test's database, serving on a free port; with an installation token, a fleet is served once switched on. */
async function started(installationToken?: string): Promise<{ app: NetworkingPluginApp; address: string }> {
  const app = createNetworkingPluginApp({ databaseUrl: pluginDatabaseUrl, fleetUrl, logger: false, ...(installationToken === undefined ? {} : { installationToken }) });
  apps.push(app);
  await app.restoreConnections();
  return { app, address: await app.server.listen({ host: '127.0.0.1', port: 0 }) };
}

/** A networking plugin process, connected to the fleet. */
async function connected(): Promise<string> {
  const { address } = await started();
  const answer = await connectPlugin(address, { cookie, shipId, secret });
  expect(answer.status, await answer.clone().text()).toBe(200);
  return address;
}

const statusSchema = z.object({
  result: z.object({ data: z.object({ state: z.string(), ship: z.object({ shipId: z.string(), name: z.string() }).nullable(), lastShipId: z.string().nullable() }) }),
});

async function status(address: string) {
  return statusSchema.parse(await (await query(address, { procedure: 'connection.status', cookie })).json()).result.data;
}

describe('a networking plugin process that was never connected', () => {
  it('starts not connected, its health saying only up and its version only the version it runs', async () => {
    const { address } = await started();

    await expect(status(address)).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: null });
    const health = await fetch(`${address}/api/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: 'ok' });
    const version = z.record(z.string(), z.string()).parse(await (await fetch(`${address}/api/version`)).json());
    expect(Object.keys(version)).toEqual(['networkingPlugin']);
    expect(version.networkingPlugin).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('connecting the networking plugin', () => {
  it('registers its ship with the secret, as a server in the aeolus-networking-plugin harness, and is connected as it', async () => {
    const address = await connected();

    await expect(status(address)).resolves.toEqual({ state: 'connected', ship: { shipId, name: 'networking-plugin' }, lastShipId: shipId });
    await expect(fleetDatabase.lease.findFirstOrThrow({ where: { shipId, endedAt: null } })).resolves.toMatchObject({ location: 'SERVER', harness: 'aeolus-networking-plugin' });
  });

  it('is refused for a ship without fleet:network', async () => {
    const reader = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'reader', type: 'networking-plugin', fleetScopes: ['fleet:read'] }));
    const { address } = await started();

    const refused = await connectPlugin(address, { cookie, shipId: reader.shipId, secret: secretOf(reader.secret) });

    expect(refused.status).toBe(400);
    await expect(status(address)).resolves.toMatchObject({ state: 'not-connected' });
  });

  it('is connected again after a restart with the kept crew token, without a new lease', async () => {
    await connected();
    await apps.splice(0)[0]?.close();

    const { address } = await started();

    await expect(status(address)).resolves.toMatchObject({ state: 'connected' });
    await expect(fleetDatabase.lease.count({ where: { shipId } })).resolves.toBe(1);
  });
});

/** Redeems a sign-in ticket at the fleet: the session cookie it starts. */
async function redeem(ticket: string): Promise<string> {
  const response = await fetch(`${fleetUrl}/trpc/console.redeemSignInTicket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  return z.string().parse(response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='))).split(';')[0] ?? '';
}

/** The fleet's network settings as the server holds them: what the plugin supplied. */
async function settings() {
  return fleetDatabase.networkSettings.findUnique({
    where: { fleetId: argo.fleetId },
    select: { rules: true, version: true, pluginShipId: true, pluginWhileUnavailable: true, pluginNotRespondingAfterSeconds: true },
  });
}

/** The answer's data, or the status and body when it failed. */
async function dataOf(response: Response): Promise<unknown> {
  expect(response.status, await response.clone().text()).toBe(200);
  return z.object({ result: z.object({ data: z.unknown() }) }).parse(await response.json()).result.data;
}

describe('supplying the fleet (decision 0035)', () => {
  const RULES = [{ from: [], to: [] }];

  it("registers as the fleet's networking plugin on connect, declaring keep-latest after 300 seconds, with no rules: all-to-all", async () => {
    await connected();

    await expect(settings()).resolves.toMatchObject({ rules: null, pluginShipId: shipId, pluginWhileUnavailable: 'keep-latest', pluginNotRespondingAfterSeconds: 300 });
  });

  it('supplies the rules argo saves to the fleet at once, and reads them back', async () => {
    const address = await connected();

    await expect(dataOf(await mutate(address, { procedure: 'network.setRules', cookie, body: { rules: RULES } }))).resolves.toEqual({ rules: RULES, supply: 'supplied' });

    await expect(settings()).resolves.toMatchObject({ rules: RULES });
    await expect(dataOf(await query(address, { procedure: 'network.get', cookie }))).resolves.toEqual({
      rules: RULES,
      declaration: { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 },
    });
  });

  it('registers again with what argo declares, keeping the rules', async () => {
    const address = await connected();
    await dataOf(await mutate(address, { procedure: 'network.setRules', cookie, body: { rules: RULES } }));

    await expect(dataOf(await mutate(address, { procedure: 'network.setDeclaration', cookie, body: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 } }))).resolves.toEqual({
      declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 },
      supply: 'supplied',
    });

    await expect(settings()).resolves.toMatchObject({ rules: RULES, pluginWhileUnavailable: 'block-all', pluginNotRespondingAfterSeconds: 120 });
  });

  it('refuses rules over the limits, naming decision 0034, and supplies nothing', async () => {
    const address = await connected();
    const before = await settings();

    const refused = await mutate(address, { procedure: 'network.setRules', cookie, body: { rules: Array.from({ length: 201 }, () => ({ from: [], to: [] })) } });

    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('decision 0034');
    await expect(settings()).resolves.toEqual(before);
  });

  it('refuses the rules until it is connected', async () => {
    const { address } = await started();

    await expect(query(address, { procedure: 'network.get', cookie }).then((response) => response.status)).resolves.toBe(412);
  });

  it('registers again and supplies the kept rules after a restart: on reconnect', async () => {
    const address = await connected();
    await dataOf(await mutate(address, { procedure: 'network.setRules', cookie, body: { rules: RULES } }));
    const before = await settings();
    await apps.splice(0)[0]?.close();

    await started();

    const after = await settings();
    expect(after).toMatchObject({ rules: RULES, pluginShipId: shipId });
    expect(after?.version).toBeGreaterThan(before?.version ?? 0);
  });
});

describe("the networking plugin's ship receiving", () => {
  it('acknowledges a message sent to it on receipt, and acts on none', async () => {
    await connected();
    apps[0]?.startReceiving();

    const { messageId } = unwrap(await useCases.sendMessage(argo, { selector: { kind: 'ship', shipId }, payload: 'Hello, networking plugin', idempotencyKey: newKey() }));

    await vi.waitFor(
      async () => {
        await expect(fleetDatabase.delivery.findFirstOrThrow({ where: { messageId } })).resolves.toMatchObject({ state: 'acknowledged' });
      },
      { timeout: 10_000, interval: 100 },
    );
  });

  it("answers argo's ping with pong: the ship's last ping is answered", async () => {
    await connected();
    apps[0]?.startReceiving();

    unwrap(await useCases.pingShip(argo, { shipId }));

    await vi.waitFor(
      async () => {
        await expect(useCases.getShip(argo, { shipId })).resolves.toMatchObject({ isOk: true, value: { ping: { state: 'answered' } } });
      },
      { timeout: 10_000, interval: 100 },
    );
  });
});

describe('the rules at a viewer session (decision 0022)', () => {
  it('are refused: argo alone sees and edits them', async () => {
    const created = unwrap(await useCases.createFleet({ requestId: newKey(), name: 'demo', operatorEmail: 'demo@example.com', hasViewer: true }));
    const viewerCookie = await redeem(unwrap(await useCases.issueSignInTicket({ fleetId: created.fleetId, as: 'viewer' })).ticket);
    const { address } = await started();

    await expect(query(address, { procedure: 'network.get', cookie: viewerCookie }).then((response) => response.status)).resolves.toBe(403);
    await expect(mutate(address, { procedure: 'network.setRules', cookie: viewerCookie, body: { rules: [] } }).then((response) => response.status)).resolves.toBe(403);
    await expect(mutate(address, { procedure: 'network.setDeclaration', cookie: viewerCookie, body: { whileUnavailable: 'open-all', notRespondingAfterSeconds: 60 } }).then((response) => response.status)).resolves.toBe(403);
  });
});

describe('the installation (decision 0021)', () => {
  const TOKEN = 'an-installation-token-of-at-least-32-characters';

  function installation(address: string, request: { procedure: string; body: unknown }): Promise<Response> {
    const headers = { 'content-type': 'application/json', 'x-aeolus-installation-token': TOKEN };
    return request.procedure === 'installation.get'
      ? fetch(`${address}/trpc/installation.get?input=${encodeURIComponent(JSON.stringify(request.body))}`, { headers })
      : fetch(`${address}/trpc/${request.procedure}`, { method: 'POST', headers, body: JSON.stringify(request.body) });
  }

  it('serves a fleet only once switched on: until then connect is refused', async () => {
    const { address } = await started(TOKEN);
    const fleetId = argo.fleetId;

    await expect(connectPlugin(address, { cookie, shipId, secret }).then((response) => response.status)).resolves.toBe(403);
    expect((await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: true } })).status).toBe(200);
    expect((await connectPlugin(address, { cookie, shipId, secret })).status).toBe(200);
    expect((await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: false } })).status).toBe(200);

    await expect(installation(address, { procedure: 'installation.get', body: { fleetId } }).then((response) => response.json())).resolves.toEqual({ result: { data: { enabled: false, connected: true } } });
  });

  it('unregisters from the fleet when switched off: no plugin and no rules there; switched on again, it supplies the kept rules', async () => {
    const { address } = await started(TOKEN);
    const fleetId = argo.fleetId;
    const rules = [{ from: [], to: [] }];
    await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: true } });
    expect((await connectPlugin(address, { cookie, shipId, secret })).status).toBe(200);
    expect((await mutate(address, { procedure: 'network.setRules', cookie, body: { rules } })).status).toBe(200);

    await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: false } });
    await expect(settings()).resolves.toMatchObject({ rules: null, pluginShipId: null });

    await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: true } });
    await expect(settings()).resolves.toMatchObject({ rules, pluginShipId: shipId });
  });

  it('unregisters from the fleet before it forgets the fleet', async () => {
    const { address } = await started(TOKEN);
    const fleetId = argo.fleetId;
    await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: true } });
    expect((await connectPlugin(address, { cookie, shipId, secret })).status).toBe(200);

    expect((await installation(address, { procedure: 'installation.delete', body: { requestId: newKey(), fleetId } })).status).toBe(200);

    await expect(settings()).resolves.toMatchObject({ rules: null, pluginShipId: null });
  });

  it("forgets the fleet's connection and switch when the fleet is deleted", async () => {
    const { address } = await started(TOKEN);
    const fleetId = argo.fleetId;
    await installation(address, { procedure: 'installation.setEnabled', body: { requestId: newKey(), fleetId, enabled: true } });
    expect((await connectPlugin(address, { cookie, shipId, secret })).status).toBe(200);

    expect((await installation(address, { procedure: 'installation.delete', body: { requestId: newKey(), fleetId } })).status).toBe(200);

    await expect(installation(address, { procedure: 'installation.get', body: { fleetId } }).then((response) => response.json())).resolves.toEqual({ result: { data: { enabled: false, connected: false } } });
  });
});
