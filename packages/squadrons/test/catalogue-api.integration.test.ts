import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../server/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../server/src/adapters/prisma/client.js';
import { createUseCases } from '../../server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../../server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../server/test/support/database.js';
import { unwrap } from '../../server/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { createSquadronsDatabase } from './support/database.js';
import { startFakeGithub, tagsAt, type FakeGithub } from './support/fake-github.js';
import { seedRepository } from './support/repositories.js';
import { newKey } from '../../server/test/support/keys.js';

// The catalogue at squadrons' tRPC door: only the fleet's signed-in operator,
// whose console session cookie the web app's server forwards, reads it; it
// holds the templates and blueprints tagged in git, and a refresh shows a new tag.

const REPO = 'github.com/acme/templates';

let github: FakeGithub;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let app: SquadronsApp;
let address: string;

async function signIn(): Promise<string> {
  const response = await fetch(`${fleetUrl}/trpc/console.signIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(FLEET_URL).origin },
    body: JSON.stringify({ email: OPERATOR.email, password: OPERATOR.password }),
  });
  const cookie = response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='));
  return z.string().parse(cookie).split(';')[0] ?? '';
}

beforeEach(async () => {
  github = await startFakeGithub();
  github.repositories.set('acme/templates', {
    tags: tagsAt(
      {
        files: {
          '.aeolus/squadrons/templates/tester.yaml': 'description: Tests.\ncheckIn: 30m\nmodel: claude-opus-5-5\ncharter: You test.\n',
          '.aeolus/squadrons/blueprints/team.yaml': `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\n`,
        },
      },
      'tester@1', 'team@1',
    ),
  });

  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  const useCases = createUseCases({ prisma: fleetDatabase });
  const argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId, secret } = unwrap(
    await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage'] }),
  );
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });

  const squadronsDatabaseUrl = await createSquadronsDatabase();
  await seedRepository(squadronsDatabaseUrl, { fleetId: argo.fleetId, name: REPO, url: 'https://github.com/acme/templates' });
  app = createSquadronsApp({
    databaseUrl: squadronsDatabaseUrl,
    fleetUrl,
    githubApiUrl: github.apiUrl,
    logger: false,
  });
  unwrap(await app.connect({ operatorFleetId: argo.fleetId, shipId, secret: secretOf(secret) }));
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  await app.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  await github.close();
});

const listed = z.object({
  result: z.object({
    data: z.object({
      templates: z.array(z.object({ name: z.string(), version: z.number(), checkInMinutes: z.number(), model: z.string().nullable(), file: z.string() })),
      blueprints: z.array(z.object({ name: z.string(), version: z.number(), file: z.string() })),
      problems: z.array(z.unknown()),
    }),
  }),
});

async function catalogueWith(cookie: string | undefined): Promise<Response> {
  return fetch(`${address}/trpc/catalogue.list`, { headers: cookie === undefined ? {} : { cookie } });
}

describe('the catalogue at the squadrons API', () => {
  it('is served once squadrons connects: connecting fetches every template repository once, recording the fetch', async () => {
    const cookie = await signIn();

    const repositories = repositoriesListed.parse(await (await fetch(`${address}/trpc/repositories.list`, { headers: { cookie } })).json()).result.data;
    const { data } = listed.parse(await (await catalogueWith(cookie)).json()).result;

    expect(repositories.map((repository) => repository.lastFetch?.error)).toEqual([null]);
    expect(data.templates.map((template) => template.name)).toEqual(['tester']);
  });

  it("gives the fleet's operator the tagged templates and blueprints", async () => {
    const response = await catalogueWith(await signIn());

    expect(response.status).toBe(200);
    const { data } = listed.parse(await response.json()).result;
    expect(data.templates).toEqual([expect.objectContaining({ name: 'tester', version: 1, checkInMinutes: 30, model: 'claude-opus-5-5', file: '.aeolus/squadrons/templates/tester.yaml' })]);
    expect(data.blueprints).toEqual([expect.objectContaining({ name: 'team', version: 1, file: '.aeolus/squadrons/blueprints/team.yaml' })]);
  });

  it('refuses without a signed-in console session', async () => {
    await expect(catalogueWith(undefined).then((response) => response.status)).resolves.toBe(401);
    await expect(catalogueWith('aeolus_session=forged').then((response) => response.status)).resolves.toBe(401);
  });

  it('shows a version tagged since, after a refresh', async () => {
    const cookie = await signIn();
    const tags = github.repositories.get('acme/templates')?.tags ?? [];
    const [first] = tags;
    if (first) {
      tags.push({ ...first, name: 'tester@2' });
    }

    const refreshed = await fetch(`${address}/trpc/catalogue.refresh`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(refreshed.status).toBe(200);
    const { data } = listed.parse(await (await catalogueWith(cookie)).json()).result;
    expect(data.templates.map((template) => template.version).sort()).toEqual([1, 2]);
  });
});

const repositoriesListed = z.object({
  result: z.object({
    data: z.array(z.object({ name: z.string(), url: z.string(), path: z.string(), hasToken: z.boolean(), addedAt: z.string(), lastFetch: z.object({ at: z.string(), error: z.string().nullable() }).nullable() })),
  }),
});

async function call(cookie: string, request: { procedure: string; body: unknown }): Promise<Response> {
  const { procedure, body } = request;
  return fetch(`${address}/trpc/${procedure}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('the template repositories at the squadrons API', () => {
  it('adds a repository by its https URL and a write-only token, keeps it with why its first fetch failed, and lists it without the token', async () => {
    const cookie = await signIn();
    const token = 'ghp_api_secret_value';

    const added = await call(cookie, { procedure: 'repositories.add', body: { url: 'https://github.com/acme/private.git', token } });

    expect(added.status, await added.clone().text()).toBe(200);
    const addedText = await added.text();
    expect(addedText).not.toContain(token);
    const listedRepositories = await (await fetch(`${address}/trpc/repositories.list`, { headers: { cookie } })).text();
    expect(listedRepositories).not.toContain(token);
    const listed = repositoriesListed.parse(JSON.parse(listedRepositories)).result.data;
    expect(listed.map(({ name, path, hasToken }) => ({ name, path, hasToken }))).toEqual([
      { name: REPO, path: '.aeolus/squadrons', hasToken: false },
      { name: 'github.com/acme/private', path: '.aeolus/squadrons', hasToken: true },
    ]);
    expect(listed[1]?.lastFetch?.error).toEqual(expect.any(String));
    expect(listed[1]?.lastFetch?.error).not.toContain(token);
  });

  it('refuses a URL that is no https URL of a repository', async () => {
    const response = await call(await signIn(), { procedure: 'repositories.add', body: { url: 'file:///srv/templates' } });

    expect(response.status).toBe(400);
  });

  it('refuses a repository that is not on GitHub, saying it reads GitHub repositories only', async () => {
    const response = await call(await signIn(), { procedure: 'repositories.add', body: { url: 'https://gitlab.com/acme/templates' } });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('squadrons reads GitHub repositories only');
  });

  it('refuses a repository added already', async () => {
    const cookie = await signIn();
    await call(cookie, { procedure: 'repositories.add', body: { url: 'https://github.com/acme/twice' } });

    await expect(call(cookie, { procedure: 'repositories.add', body: { url: 'https://github.com/acme/twice.git' } }).then((response) => response.status)).resolves.toBe(409);
  });

  it('removes a repository, and its versions leave the catalogue at once', async () => {
    const cookie = await signIn();

    const removed = await call(cookie, { procedure: 'repositories.remove', body: { name: REPO } });

    expect(removed.status).toBe(200);
    const { data } = listed.parse(await (await catalogueWith(cookie)).json()).result;
    expect(data.templates).toEqual([]);
    await expect(call(cookie, { procedure: 'repositories.remove', body: { name: REPO } }).then((response) => response.status)).resolves.toBe(404);
  });

  it('refuses the repositories without a signed-in console session', async () => {
    await expect(fetch(`${address}/trpc/repositories.list`).then((response) => response.status)).resolves.toBe(401);
  });
});
