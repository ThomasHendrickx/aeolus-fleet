import { createServer, type Server } from 'node:http';

import { ACCOUNT_TOKEN_HEADER, FLEET_HEADER, discoveryPageOutputSchema, readableContextShipsOutputSchema, shipReportsOutputSchema } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createTRPCClient, httpLink, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import { createTestIssuer, type TestIssuer } from '../src/testing/account-token-issuer.js';
import { unwrap } from '../src/testing/result.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { aPersonReadFleet } from './support/person-read-postgres.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

const INSTALLATION_TOKEN = 'aeolus_installation_test_person_reads_0123456789';
let core: PostgresCore;
let fleet: Awaited<ReturnType<typeof aPersonReadFleet>>;
let presenter: Awaited<ReturnType<typeof fleet.crew>>;
let target: Awaited<ReturnType<typeof fleet.crew>>;
let keys: Server;
let issuer: TestIssuer;
let server: FastifyInstance;
let address: string;

function client(headers: Record<string, string>): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${address}/trpc`, headers })] });
}

function token(scope = 'fleet:read', options: { hasExpired?: boolean; hasAssociation?: boolean } = {}): string {
  const hasExpired = options.hasExpired === true;
  const now = Math.floor(core.clock.now().getTime() / 1000);
  return issuer.sign({ iss: issuer.issuer, aud: fleet.fleetId, sub: 'person-read-account', org: 'test-organisation', scope, group: [], ...(options.hasAssociation === false ? {} : { person_ship: fleet.person.shipId }), iat: now - (hasExpired ? 600 : 0), exp: now + (hasExpired ? -60 : 600) });
}

beforeAll(async () => {
  core = await createPostgresCore();
  core.clock.set('2026-11-10T10:00:00.000Z');
  fleet = await aPersonReadFleet(core);
  presenter = await fleet.crew({ name: 'presenter', scopes: ['fleet:read', 'fleet:on-behalf'] });
  target = await fleet.crew({ name: 'target' });
  unwrap(await core.useCases.setStatement(target.crew, { summary: 'API target description. More detail.', capabilities: [] }));
  keys = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(issuer.keySet()));
  });
  await new Promise<void>((listening) => keys.listen(0, '127.0.0.1', listening));
  const bound = keys.address();
  if (bound === null || typeof bound === 'string') {
    throw new Error('The fixture issuer must have a listening port');
  }
  issuer = createTestIssuer(`http://127.0.0.1:${String(bound.port)}`);
  server = createApp({ databaseUrl: core.databaseUrl, publicUrl: FLEET_URL, clock: core.clock, logger: false, installationToken: INSTALLATION_TOKEN, accountTokenIssuer: issuer.issuer });
  address = await server.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await server.close();
  await new Promise<void>((closed, reject) => keys.close((error) => { if (error === undefined) { closed(); } else { reject(error); } }));
  await core.close();
});

describe('person ship read API boundaries', () => {
  it('keeps crew discovery, account context and report scope independent', async () => {
    // Given a person crew and a signed-in account with no read scope.
    const crew = client({ authorization: `Bearer ${fleet.person.crewToken}` });
    const account = client({ [ACCOUNT_TOKEN_HEADER]: token('fleet:manage') });

    // When discovery succeeds while the independent account reads are refused.
    const discovery = await crew.ship.discoveryPage.query({ search: 'target' });

    // Then description access does not grant reports or account context.
    expect(discovery.rows).toEqual([{ shipId: target.shipId, name: 'target', kind: 'agent', description: 'API target description.' }]);
    await expect(account.fleet.shipReports.query({ shipIds: [target.shipId] })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await expect(account.fleet.readableContextShips.query({})).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  });

  it('refuses chosen on-behalf subjects on both new fleet reads, retaining the old read contract', async () => {
    // Given a real ship that holds both fleet:read and fleet:on-behalf.
    const headers = { authorization: `Bearer ${presenter.crewToken}`, 'Aeolus-On-Behalf-Of': fleet.person.shipId };
    const old = await client(headers).fleet.list.query();

    // When it attempts the same subject selection on the new actor-bound reads.
    const reports = client(headers).fleet.shipReports.query({ shipIds: [target.shipId] });
    const context = client(headers).fleet.readableContextShips.query({});

    // Then only the old read accepts the header.
    expect(old.items.length).toBeGreaterThan(0);
    await Promise.all([expect(reports).rejects.toMatchObject({ data: { code: 'BAD_REQUEST' } }), expect(context).rejects.toMatchObject({ data: { code: 'BAD_REQUEST' } })]);
  });

  it('authorizes ordinary account, ship and installation reads and keeps token failures as authentication errors', async () => {
    // Given the existing three authenticated actor kinds.
    const readers = [
      client({ [ACCOUNT_TOKEN_HEADER]: token() }),
      client({ authorization: `Bearer ${presenter.crewToken}` }),
      client({ 'x-aeolus-installation-token': INSTALLATION_TOKEN, [FLEET_HEADER]: fleet.fleetId }),
    ];

    // When they ask only for one loaded report and their own context.
    for (const reader of readers) {
      const reports = await reader.fleet.shipReports.query({ shipIds: [target.shipId] });
      const context = await reader.fleet.readableContextShips.query({});
      expect(reports.rows[0]?.report.status).toBe('read');
      expect(context.rows.some(({ name }) => name === 'viewer')).toBe(true);
    }
    const expired = client({ [ACCOUNT_TOKEN_HEADER]: token('fleet:read', { hasExpired: true }) }).fleet.shipReports.query({ shipIds: [target.shipId] });

    // Then expiry is never disguised as an unavailable report.
    await expect(expired).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });

  it('reads account context without a person association and never commissions or crews one', async () => {
    // Given a verified read account with no associated person ship.
    const before = await Promise.all([core.prisma.ship.count({ where: { fleetId: fleet.fleetId } }), core.prisma.lease.count({ where: { fleetId: fleet.fleetId, endedAt: null } })]);

    // When its independent readable context is opened.
    const context = await client({ [ACCOUNT_TOKEN_HEADER]: token('fleet:read', { hasAssociation: false }) }).fleet.readableContextShips.query({});
    const after = await Promise.all([core.prisma.ship.count({ where: { fleetId: fleet.fleetId } }), core.prisma.lease.count({ where: { fleetId: fleet.fleetId, endedAt: null } })]);

    // Then no send set is excluded and the read creates no ship or lease.
    expect(context.rows.some(({ shipId }) => shipId === target.shipId)).toBe(true);
    expect(after).toEqual(before);
  });

  it('rejects unknown permission/filter fields, duplicate/oversized batches and cursor-plus-refresh inputs through REST', async () => {
    // Given authenticated resource reads, with no request-supplied permission subjects.
    const invalid = [
      { route: '/ship/discoveryPage', authorization: `Bearer ${fleet.person.crewToken}`, payload: { personShipId: presenter.shipId } },
      { route: '/ship/discoveryPage', authorization: `Bearer ${fleet.person.crewToken}`, payload: { limit: 100 } },
      { route: '/ship/discoveryPage', authorization: `Bearer ${fleet.person.crewToken}`, payload: { shipIds: [target.shipId], cursor: null } },
      { route: '/fleet/shipReports', authorization: `Bearer ${presenter.crewToken}`, payload: { shipIds: [target.shipId, target.shipId] } },
      { route: '/fleet/shipReports', authorization: `Bearer ${presenter.crewToken}`, payload: { shipIds: Array.from({ length: 21 }, (_, index) => `shp_${String(index).padStart(26, '0')}`) } },
      { route: '/fleet/readableContextShips', authorization: `Bearer ${presenter.crewToken}`, payload: { accountId: 'another-account' } },
    ];

    // When each invalid input reaches the generated REST mapping.
    for (const request of invalid) {
      const result = await server.inject({ method: 'POST', url: `/api/v1${request.route}`, headers: { authorization: request.authorization }, payload: request.payload });

      // Then it is refused by the same procedure's validation.
      expect(result.statusCode, request.route).toBe(400);
    }
    const valid = await server.inject({ method: 'POST', url: '/api/v1/fleet/shipReports', headers: { [ACCOUNT_TOKEN_HEADER]: token() }, payload: { shipIds: [target.shipId] } });
    expect(valid.statusCode).toBe(200);
    expect(shipReportsOutputSchema.parse(valid.json()).rows[0]?.report.status).toBe('read');
  });

  it('exposes all three projections through MCP using the same core procedures', async () => {
    // Given a normal MCP connection and existing crew tokens.
    const mcp = new Client({ name: 'person-read-test', version: '1.0.0' }, {});
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
    const resultSchema = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })), structuredContent: z.unknown().optional(), isError: z.boolean().optional() });
    try {
      const tools = await mcp.listTools();
      for (const name of ['discoveryPage', 'fleet_shipReports', 'fleet_readableContextShips']) {
        expect(tools.tools.map((tool) => tool.name)).toContain(name);
      }

      // When each tool is called with its own authenticated subject and bounded input.
      const discovery = resultSchema.parse(await mcp.callTool({ name: 'discoveryPage', arguments: { crewToken: fleet.person.crewToken, search: 'target' } }));
      const reports = resultSchema.parse(await mcp.callTool({ name: 'fleet_shipReports', arguments: { crewToken: presenter.crewToken, shipIds: [target.shipId] } }));
      const context = resultSchema.parse(await mcp.callTool({ name: 'fleet_readableContextShips', arguments: { crewToken: presenter.crewToken } }));
      const valueOf = (result: z.infer<typeof resultSchema>): unknown => result.structuredContent ?? JSON.parse(result.content.map(({ text }) => text).join(''));

      // Then the shared schemas accept the same authorized fields, without transport logic.
      expect(discoveryPageOutputSchema.parse(valueOf(discovery)).rows[0]?.shipId).toBe(target.shipId);
      expect(shipReportsOutputSchema.parse(valueOf(reports)).rows[0]?.report.status).toBe('read');
      expect(readableContextShipsOutputSchema.parse(valueOf(context)).rows.some(({ shipId }) => shipId === presenter.shipId)).toBe(true);
    } finally {
      await mcp.close();
    }
  });
});
