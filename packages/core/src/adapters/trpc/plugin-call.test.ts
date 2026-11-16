import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request as socketRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { randomUUID } from 'node:crypto';

import { accountIdSchema, accountTokenClaimsSchema, type PluginCallContext } from '@aeolus-fleet/common';
import { createAuthenticateAccount } from '../../domain/identity/authenticate-account.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { addAgentShip, crewShip, FLEET_URL, historyUseCases, identityUseCases, initialiseFleet, messagingUseCases, operatorCaller, OPERATOR, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { createCallPlugin } from '../../domain/registry/call-plugin.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { buildHttpServer } from '../http/server.js';
import { SHIP_CALLS } from './ship-contract.js';

const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

async function scenario() {
  const core = createInMemoryCore('2026-11-16T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  const registry = registryUseCases(core);
  const argo = operatorCaller(fleet);
  const plugin = unwrap(await registry.commissionShip(argo, { name: 'sample-plugin', type: 'sample', kind: 'plugin', idempotencyKey: newKey() }));
  const agent = addAgentShip(core, { fleetId: fleet.fleetId, scopes: [] });
  const crewToken = crewShip(core, { fleetId: fleet.fleetId, shipId: agent.shipId });
  const dispatches: PluginCallContext[] = [];
  const callPlugin = createCallPlugin({ ...core, requestId: randomUUID, transport: { dispatch: (context) => {
    dispatches.push(context);
    return Promise.resolve(context.scopes.includes('sample:change') ? { isOk: true, value: { actor: context.actor, input: context.input } } : { isOk: false, error: { kind: 'PLUGIN_REFUSED', code: 'FORBIDDEN', message: 'Plugin operation refused' } });
  } } });
  let isCutOff = false;
  const claims = accountTokenClaimsSchema.parse({ iss: 'https://issuer.example', aud: fleet.fleetId, sub: 'account-1', org: 'organisation-1', scope: 'sample:change', group: [], iat: 1794830399, exp: 1794830410 });
  const authenticateAccount = createAuthenticateAccount({ clock: core.clock, signatures: { verify: () => Promise.resolve(claims) }, cutOffs: { cutOffAt: () => Promise.resolve(isCutOff ? core.clock.now() : undefined) }, fleets: { isHosted: () => Promise.resolve(core.state.fleets.some((held) => held.id === fleet.fleetId) && !core.state.deletedFleets.some((held) => held.fleetId === fleet.fleetId)) } });
  const server = buildHttpServer({ clock: core.clock, fleetUrl: FLEET_URL, consoleOrigin: new URL(FLEET_URL).origin, logger: false, checkDatabase: () => Promise.resolve(), latestMigration: () => Promise.resolve(null), useCases: { ...identityUseCases(core), ...registry, ...messagingUseCases(core), ...historyUseCases(core), authenticateAccount, callPlugin, ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }) } });
  servers.push(server);
  const input = { pluginShipId: plugin.shipId, procedure: 'widgets.change', input: { value: 1 } };
  const call = (body: unknown = input) => server.inject({ method: 'POST', url: '/api/v1/fleet/callPlugin', headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` }, payload: JSON.stringify(body) });
  const grant = (scopes: readonly string[]) => {
    const ship = core.state.ships.find((ship) => ship.id === agent.shipId);
    if (ship) ship.scopes = scopes;
  };
  return { cutOff: () => { isCutOff = true; }, core, fleet, registry, argo, plugin, agent, crewToken, dispatches, server, input, call, grant };
}

describe('plugin actor contract slice 1: fleet.callPlugin doors', () => {
  it('maps REST and MCP to the same actor procedure and rejects forged envelope authority', async () => {
    // Given the ship tool contract and an agent with a plugin scope alone.
    const fixture = await scenario();
    fixture.grant(['sample:change']);
    // When it calls through its normal bearer connection, then forges authority fields.
    const answer = await fixture.call();
    const forged = await fixture.call({ ...fixture.input, actor: { kind: 'installation' }, scopes: ['fleet:manage'], url: 'https://attacker.example' });
    // Then core maps the call and uses only the owning ship's identity.
    expect(SHIP_CALLS.find((call) => call.name === 'fleet_callPlugin')).toMatchObject({ path: 'fleet.callPlugin', route: '/fleet/callPlugin', method: 'POST' });
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ actor: { kind: 'ship', shipId: fixture.agent.shipId }, input: { value: 1 } });
    expect(forged.statusCode).toBe(400);
    expect(fixture.dispatches).toHaveLength(1);
  });

  it('rechecks scopes on the same connection and retains the normal lease-end result', async () => {
    // Given one live crew token holding the required plugin scope.
    const fixture = await scenario();
    fixture.grant(['sample:change']);
    expect((await fixture.call()).statusCode).toBe(200);
    // When its scope is revoked and later its lease ends.
    fixture.grant([]);
    const revoked = await fixture.call();
    unwrap(await fixture.registry.releaseShip(fixture.argo, { shipId: fixture.agent.shipId }));
    const ended = await fixture.call();
    // Then the plugin refuses the fresh scope snapshot and core refuses the ended lease.
    expect(revoked.statusCode).toBe(403);
    expect(ended.statusCode).toBe(401);
    expect(ended.json()).toMatchObject({ code: 'LEASE_ENDED' });
    expect(fixture.dispatches).toHaveLength(2);
    expect(fixture.dispatches[1]?.scopes).not.toContain('sample:change');
  });

  it('refuses missing credentials and a serialized envelope over 256 KB before dispatch', async () => {
    // Given a connected plugin.
    const fixture = await scenario();
    // When there is no authenticated actor, or the whole envelope exceeds the payload limit.
    const missing = await fixture.server.inject({ method: 'POST', url: '/api/v1/fleet/callPlugin', payload: fixture.input });
    const oversized = await fixture.call({ ...fixture.input, input: 'x'.repeat(256 * 1024) });
    // Then nothing is dispatched.
    expect(missing.statusCode).toBe(401);
    expect(oversized.statusCode).toBe(400);
    expect(fixture.dispatches).toEqual([]);
  });
  it('preserves account identity and throughShipId, bounds the deadline and authenticates again after cut-off', async () => {
    // Given a checked account token presented by an agent through its normal connection.
    const fixture = await scenario();
    const request = () => fixture.server.inject({ method: 'POST', url: '/api/v1/fleet/callPlugin', headers: { authorization: `Bearer ${fixture.crewToken}`, 'aeolus-account-token': 'checked-account-token' }, payload: fixture.input });
    // When that account calls and its token is then cut off.
    const answer = await request();
    fixture.cutOff();
    const cutOff = await request();
    // Then the plugin sees the account rather than the presenting ship and no stale authorization survives.
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({ actor: { kind: 'account', accountId: 'account-1', throughShipId: fixture.agent.shipId } });
    expect(fixture.dispatches[0]?.expiresAt).toBe('2026-11-16T12:00:10.000Z');
    expect(cutOff.statusCode).toBe(401);
    expect(fixture.dispatches).toHaveLength(1);
  });
  it('bounds a console dispatch by the known sign-in expiry and retains Origin refusals', async () => {
    // Given a console sign-in that ends in ten seconds.
    const fixture = await scenario();
    const signedIn = await fixture.server.inject({ method: 'POST', url: '/trpc/console.signIn', payload: OPERATOR, headers: { origin: new URL(FLEET_URL).origin } });
    const cookie = signedIn.headers['set-cookie']?.toString().split(';')[0] ?? '';
    const session = fixture.core.state.consoleSessions.find((held) => held.endedAt === null);
    if (!session) throw new Error('No console sign-in');
    session.endsBy = new Date('2026-11-16T12:00:10.000Z');
    session.expiresAt = session.endsBy;
    const argo = fixture.core.state.ships.find((ship) => ship.id === fixture.argo.shipId);
    if (!argo) throw new Error('No argo');
    argo.scopes = [...argo.scopes, 'sample:change'];
    // When the sign-in calls from an untrusted Origin, then the console's own.
    const refused = await fixture.server.inject({ method: 'POST', url: '/trpc/fleet.callPlugin', headers: { cookie, origin: 'https://attacker.example' }, payload: fixture.input });
    const answer = await fixture.server.inject({ method: 'POST', url: '/trpc/fleet.callPlugin', headers: { cookie, origin: new URL(FLEET_URL).origin }, payload: fixture.input });
    // Then the normal Origin guard remains and the server context cannot outlive the sign-in.
    expect(refused.statusCode).toBe(403);
    expect(answer.statusCode).toBe(200);
    expect(fixture.dispatches).toHaveLength(1);
    expect(fixture.dispatches[0]?.expiresAt).toBe('2026-11-16T12:00:10.000Z');
  });

  it('calls the MCP tool as the owning ship rather than the ship in connection headers', async () => {
    // Given the normal MCP connection and a plugin-scoped owning ship.
    const fixture = await scenario();
    fixture.grant(['sample:change']);
    const address = await fixture.server.listen({ port: 0, host: '127.0.0.1' });
    const client = new Client({ name: 'plugin-contract-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`), { requestInit: { headers: { authorization: 'Bearer a-trierarch-connection-credential' } } }));
    try {
      // When a socket's owning-ship credential is forwarded as the tool argument.
      const answer = await client.callTool({ name: 'fleet_callPlugin', arguments: { ...fixture.input, crewToken: fixture.crewToken } });
      // Then core uses that ship and returns no credential in its result.
      expect(answer.isError).not.toBe(true);
      expect(fixture.dispatches[0]?.actor).toEqual({ kind: 'ship', shipId: fixture.agent.shipId });
      expect(JSON.stringify(answer)).not.toContain(fixture.crewToken);
    } finally { await client.close(); }
  });

  it('authenticates a fresh account call again after the fleet is deleted', async () => {
    // Given a checked account token calling directly, without a ship credential.
    const fixture = await scenario();
    const request = () => fixture.server.inject({ method: 'POST', url: '/api/v1/fleet/callPlugin', headers: { 'aeolus-account-token': 'checked-account-token' }, payload: fixture.input });
    expect((await request()).statusCode).toBe(200);
    // When the installation deletes that fleet before the next call.
    unwrap(await fixture.registry.deleteFleet({ fleetId: fixture.fleet.fleetId, requestId: newKey() }));
    const answer = await request();
    // Then the prior scope snapshot grants nothing in a deleted fleet.
    expect(answer.statusCode).toBe(401);
    expect(fixture.dispatches).toHaveLength(1);
  });

  it('accepts a socket-forwarded operation under the owning ship credential without exposing it to the socket caller', async () => {
    // Given a thin socket adapter that holds the owning ship's credential on the server.
    const fixture = await scenario();
    fixture.grant(['sample:change']);
    const directory = await mkdtemp(join(tmpdir(), 'plugin-socket-'));
    const socketPath = join(directory, 'ship.sock');
    const proxy = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (data: unknown) => { if (Buffer.isBuffer(data)) chunks.push(data); });
      request.on('end', () => {
        void fixture.server.inject({ method: 'POST', url: '/api/v1/fleet/callPlugin', headers: { authorization: `Bearer ${fixture.crewToken}`, 'content-type': 'application/json' }, payload: Buffer.concat(chunks).toString() }).then((answer) => { response.writeHead(answer.statusCode); response.end(answer.body); });
      });
    });
    await new Promise<void>((resolve) => { proxy.listen(socketPath, resolve); });
    try {
      // When a session calls over the socket with only the public envelope.
      const answer = await new Promise<string>((resolve, reject) => {
        const request = socketRequest({ socketPath, path: '/fleet/callPlugin', method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => { body += chunk; });
          response.on('end', () => { resolve(body); });
        });
        request.on('error', reject);
        request.end(JSON.stringify(fixture.input));
      });
      // Then the verified actor is the owning ship and its credential stays on the server.
      const body: unknown = JSON.parse(answer);
      expect(body).toMatchObject({ actor: { kind: 'ship', shipId: fixture.agent.shipId } });
      expect(answer).not.toContain(fixture.crewToken);
      expect(JSON.stringify(fixture.input)).not.toContain(fixture.crewToken);
    } finally {
      await new Promise<void>((resolve) => { proxy.close(() => { resolve(); }); });
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('passes argo the declared plugin scopes through the same scope check and preserves the signing account', async () => {
    // Given a plugin declaring its scope and an account signed in as argo.
    const fixture = await scenario();
    const pluginToken = crewShip(fixture.core, { fleetId: fixture.fleet.fleetId, shipId: fixture.plugin.shipId });
    const pluginCaller = unwrap(await identityUseCases(fixture.core).authenticate.byCrewToken(pluginToken));
    unwrap(await fixture.registry.declareScopes(pluginCaller, { namespace: 'sample', scopes: [{ scope: 'sample:change', description: 'Change a sample widget' }] }));
    const signedIn = await fixture.server.inject({ method: 'POST', url: '/trpc/console.signIn', payload: OPERATOR, headers: { origin: new URL(FLEET_URL).origin } });
    const cookie = signedIn.headers['set-cookie']?.toString().split(';')[0] ?? '';
    const session = fixture.core.state.consoleSessions.find((held) => held.endedAt === null);
    if (!session) throw new Error('No console sign-in');
    session.accountId = accountIdSchema.parse('account-signing-as-argo');
    // When argo calls, without an explicit plugin grant or an operator bypass in the plugin.
    const answer = await fixture.server.inject({ method: 'POST', url: '/trpc/fleet.callPlugin', headers: { cookie, origin: new URL(FLEET_URL).origin }, payload: fixture.input });
    // Then the ordinary scope check succeeds from effective scopes and the actual event actor survives.
    expect(answer.statusCode).toBe(200);
    expect(fixture.dispatches[0]?.scopes).toContain('sample:change');
    expect(fixture.dispatches[0]?.actor).toEqual({ kind: 'ship', shipId: fixture.argo.shipId, signedInAccountId: 'account-signing-as-argo' });
  });

});
