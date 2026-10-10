import type { FleetId, ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../core/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../core/src/adapters/prisma/client.js';
import { createUseCases } from '../../core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../../core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../core/test/support/database.js';
import { newKey } from '../../core/test/support/keys.js';
import { unwrap } from '../../core/test/support/result.js';
import { createPrismaClient as createSquadronsPrismaClient } from '../src/adapters/prisma/client.js';
import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { createSquadronsDatabase } from './support/database.js';
import { startFakeGithub, tagsAt, type FakeGithub } from './support/fake-github.js';
import { seedRepository } from './support/repositories.js';

// The installation API (decision 0021): a hosting service switches squadrons
// on or off per fleet and deletes a fleet's records, with the installation
// token. Without a token squadrons is open: every fleet is served, as
// self-hosted squadrons always was.

const TOKEN = 'an-installation-token-of-at-least-32-characters';
const REPO = 'github.com/acme/templates';

let github: FakeGithub;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let squadronsDatabaseUrl: string;
let app: SquadronsApp;
let address: string;
let fleetId: FleetId;
let management: { shipId: ShipId; secret: string };
let cookie: string;

async function signIn(): Promise<string> {
  const response = await fetch(`${fleetUrl}/trpc/console.signIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(FLEET_URL).origin },
    body: JSON.stringify({ email: OPERATOR.email, password: OPERATOR.password }),
  });
  const set = response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='));
  return z.string().parse(set).split(';')[0] ?? '';
}

/** squadrons on the test's database, with or without an installation token. */
async function startSquadrons(installationToken?: string): Promise<void> {
  app = createSquadronsApp({ databaseUrl: squadronsDatabaseUrl, fleetUrl, githubApiUrl: github.apiUrl, logger: false, ...(installationToken === undefined ? {} : { installationToken }) });
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
}

function installation(request: { procedure: string; body: unknown; token?: string | null }): Promise<Response> {
  const token = request.token === undefined ? TOKEN : request.token;
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(token === null ? {} : { 'x-aeolus-installation-token': token }) };
  return request.procedure === 'installation.get'
    ? fetch(`${address}/trpc/installation.get?input=${encodeURIComponent(JSON.stringify(request.body))}`, { headers })
    : fetch(`${address}/trpc/${request.procedure}`, { method: 'POST', headers, body: JSON.stringify(request.body) });
}

async function dataOf(response: Response): Promise<unknown> {
  expect(response.status, await response.clone().text()).toBe(200);
  return z.object({ result: z.object({ data: z.unknown() }) }).parse(await response.json()).result.data;
}

function asOperator(procedure: string, body?: unknown): Promise<Response> {
  return body === undefined
    ? fetch(`${address}/trpc/${procedure}`, { headers: { cookie } })
    : fetch(`${address}/trpc/${procedure}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

const statusSchema = z.object({ enabled: z.boolean(), state: z.string() });
const repositoriesSchema = z.array(z.object({ name: z.string() }));

beforeEach(async () => {
  github = await startFakeGithub();
  github.repositories.set('acme/templates', {
    tags: tagsAt(
      {
        files: {
          '.aeolus/squadrons/templates/tester.yaml': 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n',
          '.aeolus/squadrons/blueprints/team.yaml': `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\n`,
        },
      },
      'tester@1',
      'team@1',
    ),
  });
  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  const useCases = createUseCases({ prisma: fleetDatabase });
  const founded = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  fleetId = founded.fleetId;
  const commissioned = unwrap(
    await useCases.commissionShip(operatorCaller(founded), { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage'] }),
  );
  management = { shipId: commissioned.shipId, secret: secretOf(commissioned.secret) };
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: 500 });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });
  squadronsDatabaseUrl = await createSquadronsDatabase();
  await seedRepository(squadronsDatabaseUrl, { fleetId, name: REPO, url: 'https://github.com/acme/templates' });
  cookie = await signIn();
});

afterEach(async () => {
  await app.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  await github.close();
});

describe('an open installation, with no installation token', () => {
  it('serves every fleet as before, and has no installation procedures', async () => {
    await startSquadrons();

    expect(statusSchema.parse(await dataOf(await asOperator('connection.status')))).toEqual({ enabled: true, state: 'not-connected' });
    await expect(installation({ procedure: 'installation.get', body: { fleetId } }).then((response) => response.status)).resolves.toBe(404);
    await expect(fetch(`${address}/api/health`).then((response) => response.json())).resolves.toEqual({ status: 'ok' });
  });
});

describe('an enabled installation, with an installation token', () => {
  beforeEach(async () => {
    await startSquadrons(TOKEN);
  });

  it.each([
    ['no token', null],
    ['a wrong token', 'not-the-installation-token-but-just-as-long-xx'],
  ])('refuses the installation procedures with %s', async (_label, token) => {
    await expect(installation({ procedure: 'installation.get', body: { fleetId }, token }).then((response) => response.status)).resolves.toBe(401);
  });

  it('serves no fleet until it is switched on: the console reads it off, and connecting and every other procedure are refused', async () => {
    expect(statusSchema.parse(await dataOf(await asOperator('connection.status')))).toEqual({ enabled: false, state: 'not-connected' });
    await expect(asOperator('repositories.list').then((response) => response.status)).resolves.toBe(403);
    await expect(asOperator('connection.connect', { shipId: management.shipId, secret: management.secret }).then((response) => response.status)).resolves.toBe(403);
    await expect(dataOf(await installation({ procedure: 'installation.get', body: { fleetId } }))).resolves.toEqual({ enabled: false, connected: false });
  });

  it('serves a fleet switched on, and keeps everything of it while it is off again', async () => {
    await expect(dataOf(await installation({ procedure: 'installation.setEnabled', body: { requestId: 'r-on', fleetId, enabled: true } }))).resolves.toEqual({ fleetId, enabled: true });
    await dataOf(await asOperator('connection.connect', { shipId: management.shipId, secret: management.secret }));
    await expect(dataOf(await installation({ procedure: 'installation.get', body: { fleetId } }))).resolves.toEqual({ enabled: true, connected: true });

    await dataOf(await installation({ procedure: 'installation.setEnabled', body: { requestId: 'r-off', fleetId, enabled: false } }));
    await expect(asOperator('repositories.list').then((response) => response.status)).resolves.toBe(403);
    await dataOf(await installation({ procedure: 'installation.setEnabled', body: { requestId: 'r-on-again', fleetId, enabled: true } }));

    expect(statusSchema.parse(await dataOf(await asOperator('connection.status')))).toEqual({ enabled: true, state: 'connected' });
    expect(repositoriesSchema.parse(await dataOf(await asOperator('repositories.list'))).map((each) => each.name)).toEqual([REPO]);
  });

  it('forgets everything of a deleted fleet: no record of it stays in squadrons, and it is off and not connected', async () => {
    await dataOf(await installation({ procedure: 'installation.setEnabled', body: { requestId: 'r-on', fleetId, enabled: true } }));
    await dataOf(await asOperator('connection.connect', { shipId: management.shipId, secret: management.secret }));
    const formed = await asOperator('squadrons.form', { blueprint: { repository: REPO, name: 'team', version: 1 }, squadronId: 'team-one' });
    expect(formed.status, await formed.clone().text()).toBe(200);

    await expect(dataOf(await installation({ procedure: 'installation.delete', body: { requestId: 'r-delete', fleetId } }))).resolves.toEqual({});

    await expect(dataOf(await installation({ procedure: 'installation.get', body: { fleetId } }))).resolves.toEqual({ enabled: false, connected: false });
    const squadronsDatabase = createSquadronsPrismaClient(squadronsDatabaseUrl);
    const where = { where: { fleetId } };
    const left = await Promise.all([
      squadronsDatabase.templateRepository.count(where),
      squadronsDatabase.squadron.count(where),
      squadronsDatabase.member.count(where),
      squadronsDatabase.formationAttempt.count(where),
      squadronsDatabase.managementCrew.count(where),
      squadronsDatabase.fleetSwitch.count(where),
      squadronsDatabase.installationRequest.count(where),
    ]);
    await squadronsDatabase.$disconnect();
    expect(left).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('answers a replayed request id with its first answer, and refuses one used for another request', async () => {
    await dataOf(await installation({ procedure: 'installation.setEnabled', body: { requestId: 'r-1', fleetId, enabled: true } }));
    await dataOf(await installation({ procedure: 'installation.setEnabled', body: { requestId: 'r-2', fleetId, enabled: false } }));

    await expect(dataOf(await installation({ procedure: 'installation.setEnabled', body: { requestId: 'r-1', fleetId, enabled: true } }))).resolves.toEqual({ fleetId, enabled: true });
    await expect(installation({ procedure: 'installation.setEnabled', body: { requestId: 'r-1', fleetId, enabled: false } }).then((response) => response.status)).resolves.toBe(409);
    await expect(dataOf(await installation({ procedure: 'installation.get', body: { fleetId } }))).resolves.toEqual({ enabled: false, connected: false });
  });

  it('says in its health and version nothing about its connected fleets or its installation', async () => {
    await dataOf(await installation({ procedure: 'installation.setEnabled', body: { requestId: 'r-on', fleetId, enabled: true } }));
    await dataOf(await asOperator('connection.connect', { shipId: management.shipId, secret: management.secret }));

    await expect(fetch(`${address}/api/health`).then((response) => response.json())).resolves.toEqual({ status: 'ok' });
    await expect(fetch(`${address}/api/version`).then(async (response) => Object.keys(z.record(z.string(), z.string()).parse(await response.json())))).resolves.toEqual(['squadrons']);
  });
});
