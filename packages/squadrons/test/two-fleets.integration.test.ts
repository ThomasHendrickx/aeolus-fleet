import type { FleetId, ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { argon2idPasswordHasher } from '../../core/src/adapters/crypto/passwords.js';
import { createApp } from '../../core/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../core/src/adapters/prisma/client.js';
import { createUseCases } from '../../core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../../core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../core/test/support/database.js';
import { newKey } from '../../core/test/support/keys.js';
import { unwrap } from '../../core/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { createSquadronsDatabase } from './support/database.js';
import { startFakeGithub, tagsAt, type FakeGithub } from './support/fake-github.js';
import { seedRepository } from './support/repositories.js';

// One squadrons install serving two fleets of one server, each connected with
// its own management ship: neither fleet's operator ever sees the other's
// repositories, catalogue, squadrons or connection.

const OTHER_OPERATOR = { email: 'other@example.com', password: 'another correct horse battery' };

let github: FakeGithub;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let app: SquadronsApp;
let address: string;
let ours: { fleetId: FleetId; managementShipId: ShipId; cookie: string };
let theirs: { fleetId: FleetId; managementShipId: ShipId; cookie: string };

function teamFiles(repository: string): Record<string, string> {
  return {
    '.aeolus/squadrons/templates/tester.yaml': 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n',
    '.aeolus/squadrons/blueprints/team.yaml': `description: A team.\nroles:\n  tester:\n    template: ${repository}#tester@1\n`,
  };
}

async function signIn(operator: { email: string; password: string }): Promise<string> {
  const response = await fetch(`${fleetUrl}/trpc/console.signIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(FLEET_URL).origin },
    body: JSON.stringify(operator),
  });
  const set = response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='));
  return z.string().parse(set).split(';')[0] ?? '';
}

async function query(cookie: string, procedure: string): Promise<unknown> {
  const response = await fetch(`${address}/trpc/${procedure}`, { headers: { cookie } });
  return z.object({ result: z.object({ data: z.unknown() }) }).parse(await response.json()).result.data;
}

async function mutate(cookie: string, request: { procedure: string; body: unknown }): Promise<Response> {
  return fetch(`${address}/trpc/${request.procedure}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(request.body) });
}

beforeEach(async () => {
  github = await startFakeGithub();
  github.repositories.set('acme/ours', { tags: tagsAt({ files: teamFiles('github.com/acme/ours') }, 'tester@1', 'team@1') });
  github.repositories.set('acme/theirs', { tags: tagsAt({ files: teamFiles('github.com/acme/theirs') }, 'tester@1', 'team@1') });

  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  const useCases = createUseCases({ prisma: fleetDatabase });
  const ourFleet = unwrap(await useCases.initialiseFleet({ name: 'our fleet', ...OPERATOR }));
  const theirFleet = unwrap(await useCases.createFleet({ requestId: newKey(), name: 'their fleet', operatorEmail: OTHER_OPERATOR.email }));
  // A hosted operator has no password; this one gets one, so the test can sign in to its console.
  await fleetDatabase.operator.update({ where: { fleetId: theirFleet.fleetId }, data: { passwordHash: await argon2idPasswordHasher.hash(OTHER_OPERATOR.password) } });
  const ourArgo = operatorCaller(ourFleet);
  // argo of their fleet: the same scopes, in the other fleet.
  const theirArgo = { ...ourArgo, fleetId: theirFleet.fleetId, shipId: theirFleet.operatorShipId };
  const management = async (argo: typeof ourArgo) =>
    unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage'] }));
  const ourManagement = await management(ourArgo);
  const theirManagement = await management(theirArgo);
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: 500 });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });

  const squadronsDatabaseUrl = await createSquadronsDatabase();
  await seedRepository(squadronsDatabaseUrl, { fleetId: ourFleet.fleetId, name: 'github.com/acme/ours', url: 'https://github.com/acme/ours' });
  await seedRepository(squadronsDatabaseUrl, { fleetId: theirFleet.fleetId, name: 'github.com/acme/theirs', url: 'https://github.com/acme/theirs' });
  app = createSquadronsApp({ databaseUrl: squadronsDatabaseUrl, fleetUrl, githubApiUrl: github.apiUrl, logger: false });
  unwrap(await app.connect({ operatorFleetId: ourFleet.fleetId, shipId: ourManagement.shipId, secret: secretOf(ourManagement.secret) }));
  unwrap(await app.connect({ operatorFleetId: theirFleet.fleetId, shipId: theirManagement.shipId, secret: secretOf(theirManagement.secret) }));
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  ours = { fleetId: ourFleet.fleetId, managementShipId: ourManagement.shipId, cookie: await signIn(OPERATOR) };
  theirs = { fleetId: theirFleet.fleetId, managementShipId: theirManagement.shipId, cookie: await signIn(OTHER_OPERATOR) };
});

afterEach(async () => {
  await app.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  await github.close();
});

const repositoriesSchema = z.array(z.object({ name: z.string() }));
const catalogueSchema = z.object({ templates: z.array(z.object({ repository: z.string() })), blueprints: z.array(z.object({ repository: z.string() })) });
const connectionSchema = z.object({ state: z.string(), ship: z.object({ shipId: z.string() }).nullable() });
const squadronsSchema = z.array(z.object({ id: z.string() }));

describe('two fleets served by one squadrons install', () => {
  it('each sees only its own template repositories', async () => {
    expect(repositoriesSchema.parse(await query(ours.cookie, 'repositories.list')).map((each) => each.name)).toEqual(['github.com/acme/ours']);
    expect(repositoriesSchema.parse(await query(theirs.cookie, 'repositories.list')).map((each) => each.name)).toEqual(['github.com/acme/theirs']);
  });

  it('each sees only its own catalogue', async () => {
    const ourCatalogue = catalogueSchema.parse(await query(ours.cookie, 'catalogue.list'));
    const theirCatalogue = catalogueSchema.parse(await query(theirs.cookie, 'catalogue.list'));

    expect([...ourCatalogue.templates, ...ourCatalogue.blueprints].map((each) => each.repository)).toEqual(['github.com/acme/ours', 'github.com/acme/ours']);
    expect([...theirCatalogue.templates, ...theirCatalogue.blueprints].map((each) => each.repository)).toEqual(['github.com/acme/theirs', 'github.com/acme/theirs']);
  });

  it('each is connected as its own management ship', async () => {
    expect(connectionSchema.parse(await query(ours.cookie, 'connection.status'))).toMatchObject({ state: 'connected', ship: { shipId: ours.managementShipId } });
    expect(connectionSchema.parse(await query(theirs.cookie, 'connection.status'))).toMatchObject({ state: 'connected', ship: { shipId: theirs.managementShipId } });
  });

  it("forms in its own fleet only, and never sees, stands down or forms from the other's", async () => {
    const formed = await mutate(ours.cookie, { procedure: 'squadrons.form', body: { blueprint: { repository: 'github.com/acme/ours', name: 'team', version: 1 }, squadronId: 'team-one' } });
    expect(formed.status, await formed.clone().text()).toBe(200);

    expect(squadronsSchema.parse(await query(ours.cookie, 'squadrons.list')).map((each) => each.id)).toEqual(['team-one']);
    expect(squadronsSchema.parse(await query(theirs.cookie, 'squadrons.list'))).toEqual([]);
    await expect(mutate(theirs.cookie, { procedure: 'squadrons.forceStandDown', body: { squadronId: 'team-one' } }).then((response) => response.status)).resolves.toBe(404);
    const fromOurs = await mutate(theirs.cookie, { procedure: 'squadrons.form', body: { blueprint: { repository: 'github.com/acme/ours', name: 'team', version: 1 } } });
    expect(fromOurs.status).toBe(404);
  });

  it("removes a repository in its own fleet only, leaving the other's", async () => {
    await mutate(theirs.cookie, { procedure: 'repositories.remove', body: { name: 'github.com/acme/ours' } }).then((response) => {
      expect(response.status).toBe(404);
    });

    expect(repositoriesSchema.parse(await query(ours.cookie, 'repositories.list')).map((each) => each.name)).toEqual(['github.com/acme/ours']);
  });
});
