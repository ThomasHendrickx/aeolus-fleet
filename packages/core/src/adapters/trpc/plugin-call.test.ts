import { randomUUID } from 'node:crypto';

import { accountTokenClaimsSchema, type PluginCallContext } from '@aeolus-fleet/common';
import { createAuthenticateAccount } from '../../domain/identity/authenticate-account.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { addAgentShip, crewShip, FLEET_URL, historyUseCases, identityUseCases, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
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
  const authenticateAccount = createAuthenticateAccount({ clock: core.clock, signatures: { verify: () => Promise.resolve(claims) }, cutOffs: { cutOffAt: () => Promise.resolve(isCutOff ? core.clock.now() : undefined) }, fleets: { isHosted: () => Promise.resolve(core.state.fleets.some((held) => held.id === fleet.fleetId)) } });
  const server = buildHttpServer({ clock: core.clock, fleetUrl: FLEET_URL, logger: false, checkDatabase: () => Promise.resolve(), latestMigration: () => Promise.resolve(null), useCases: { ...identityUseCases(core), ...registry, ...messagingUseCases(core), ...historyUseCases(core), authenticateAccount, callPlugin, ping: () => Promise.resolve({ serverTime: core.clock.now(), fleetCount: 1 }) } });
  servers.push(server);
  const input = { pluginShipId: plugin.shipId, procedure: 'widgets.change', input: { value: 1 } };
  const call = (body: unknown = input, token: string | undefined = crewToken) => server.inject({ method: 'POST', url: '/api/v1/fleet/callPlugin', headers: token === undefined ? {} : { authorization: `Bearer ${token}` }, payload: body });
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

});
