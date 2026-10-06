import { SCOPES, type FleetId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../core/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../core/src/adapters/prisma/client.js';
import { createUseCases } from '../../core/src/wiring.js';
import { FLEET_URL, secretOf } from '../../core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../core/test/support/database.js';
import { newKey } from '../../core/test/support/keys.js';
import { unwrap } from '../../core/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { createSquadronsDatabase } from './support/database.js';
import { startFakeGithub, tagsAt, type FakeGithub } from './support/fake-github.js';
import { seedRepository } from './support/repositories.js';

// A viewer session at squadrons' tRPC door (decision 0022): the fleet says
// the session is a viewer's with fleet:read only, so squadrons serves it the
// catalogue, the squadrons, their kept messages and the connection, and
// refuses every other procedure, as it would a missing scope.

const REPO = 'github.com/acme/templates';
const FORBIDDEN = 403;
const OK = 200;

let github: FakeGithub;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let app: SquadronsApp;
let address: string;
let viewerCookie: string;

async function redeem(ticket: string): Promise<string> {
  const response = await fetch(`${fleetUrl}/trpc/console.redeemSignInTicket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  const cookie = response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='));
  return z.string().parse(cookie).split(';')[0] ?? '';
}

beforeEach(async () => {
  github = await startFakeGithub();
  github.repositories.set('acme/templates', {
    tags: tagsAt({ files: { '.aeolus/squadrons/templates/tester.yaml': 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n' } }, 'tester@1'),
  });

  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  const useCases = createUseCases({ prisma: fleetDatabase });
  const created = unwrap(await useCases.createFleet({ requestId: newKey(), name: 'demo', operatorEmail: 'demo@example.com', hasViewer: true }));
  const fleetId: FleetId = created.fleetId;
  // argo of the created fleet, as its console session makes it.
  const argo = { fleetId, shipId: created.operatorShipId, kind: 'operator' as const, scopes: [...SCOPES] };
  const { shipId, secret } = unwrap(
    await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage'] }),
  );
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: 500 });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });

  const squadronsDatabaseUrl = await createSquadronsDatabase();
  await seedRepository(squadronsDatabaseUrl, { fleetId, name: REPO, url: 'https://github.com/acme/templates' });
  app = createSquadronsApp({ databaseUrl: squadronsDatabaseUrl, fleetUrl, githubApiUrl: github.apiUrl, logger: false });
  unwrap(await app.connect({ operatorFleetId: fleetId, shipId, secret: secretOf(secret) }));
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  viewerCookie = await redeem(unwrap(await useCases.issueSignInTicket({ fleetId, as: 'viewer' })).ticket);
});

afterEach(async () => {
  await app.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  await github.close();
});

function query(procedure: string, input?: unknown): Promise<Response> {
  const search = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  return fetch(`${address}/trpc/${procedure}${search}`, { headers: { cookie: viewerCookie } });
}

function mutate(procedure: string, body: unknown): Promise<Response> {
  return fetch(`${address}/trpc/${procedure}`, { method: 'POST', headers: { cookie: viewerCookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('a viewer session at squadrons', () => {
  it.each([
    ['catalogue.list', undefined],
    ['squadrons.list', undefined],
    ['squadrons.messages', { squadronId: 'sqd_01m3tb1zgr5h2ffee12xnch8sv' }],
    ['connection.status', undefined],
  ])('reads %s', async (procedure, input) => {
    await expect(query(procedure, input).then((response) => response.status)).resolves.toBe(OK);
  });

  it('reads the catalogue as the operator does', async () => {
    const response = await query('catalogue.list');

    const body = z.object({ result: z.object({ data: z.object({ templates: z.array(z.object({ name: z.string() })) }) }) }).parse(await response.json());
    expect(body.result.data.templates.map((template) => template.name)).toEqual(['tester']);
  });

  it('is refused the template repositories, which name where the fleet keeps its files', async () => {
    await expect(query('repositories.list').then((response) => response.status)).resolves.toBe(FORBIDDEN);
  });

  it.each([
    'connection.connect',
    'squadrons.form',
    'squadrons.standDown',
    'squadrons.forceStandDown',
    'squadrons.addMember',
    'squadrons.removeMember',
    'squadrons.newCrewLine',
    'repositories.add',
    'repositories.remove',
    'catalogue.refresh',
  ])('is refused %s, before its input is even read', async (procedure) => {
    await expect(mutate(procedure, {}).then((response) => response.status)).resolves.toBe(FORBIDDEN);
  });
});
