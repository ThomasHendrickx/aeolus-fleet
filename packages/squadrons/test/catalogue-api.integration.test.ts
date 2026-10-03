import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../server/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../server/src/adapters/prisma/client.js';
import { createUseCases } from '../../server/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretIn } from '../../server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../server/test/support/database.js';
import { unwrap } from '../../server/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { createSquadronsDatabase } from './support/database.js';

// The catalogue at squadrons' tRPC door: only the fleet's signed-in operator,
// whose console session cookie the web app's server forwards, reads it; it
// holds the templates and blueprints tagged in git, and a refresh shows a new tag.

const run = promisify(execFile);
const REPO = 'example.com/templates';

let work: string;
let origin: string;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let app: SquadronsApp;
let address: string;

async function git(...args: string[]): Promise<void> {
  await run('git', ['-C', origin, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' },
  });
}

function write(path: string, content: string): void {
  mkdirSync(join(origin, path, '..'), { recursive: true });
  writeFileSync(join(origin, path), content);
}

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
  work = mkdtempSync(join(tmpdir(), 'aeolus-catalogue-api-'));
  origin = join(work, 'templates');
  mkdirSync(origin);
  await git('init', '--quiet', '--initial-branch=main');
  write('squadrons/templates/tester.yaml', 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n');
  write('squadrons/blueprints/team.yaml', `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\nentry: tester\n`);
  await git('add', '.');
  await git('commit', '--quiet', '-m', 'team');
  await git('tag', 'tester@1');
  await git('tag', 'team@1');

  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  const useCases = createUseCases({ prisma: fleetDatabase, fleetUrl: FLEET_URL });
  const argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId, prompt } = unwrap(
    await useCases.commissionShip(argo, { name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage'] }),
  );
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });

  app = createSquadronsApp({
    databaseUrl: await createSquadronsDatabase(),
    fleetUrl,
    managementShip: { shipId: shipId satisfies ShipId, secret: secretIn(prompt) },
    repositories: [{ url: `file://${origin}`, name: REPO, path: undefined, token: undefined }],
    cacheDir: join(work, 'cache'),
    logger: false,
  });
  unwrap(await app.crewManagementShip());
  await app.refreshCatalogue();
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  await app.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  rmSync(work, { recursive: true, force: true });
});

const listed = z.object({
  result: z.object({
    data: z.object({
      templates: z.array(z.object({ name: z.string(), version: z.number(), checkInMinutes: z.number() })),
      blueprints: z.array(z.object({ name: z.string(), version: z.number(), entry: z.string() })),
      problems: z.array(z.unknown()),
    }),
  }),
});

async function catalogueWith(cookie: string | undefined): Promise<Response> {
  return fetch(`${address}/trpc/catalogue.list`, { headers: cookie === undefined ? {} : { cookie } });
}

describe('the catalogue at the squadrons API', () => {
  it("gives the fleet's operator the tagged templates and blueprints", async () => {
    const response = await catalogueWith(await signIn());

    expect(response.status).toBe(200);
    const { data } = listed.parse(await response.json()).result;
    expect(data.templates).toEqual([expect.objectContaining({ name: 'tester', version: 1, checkInMinutes: 30 })]);
    expect(data.blueprints).toEqual([expect.objectContaining({ name: 'team', version: 1, entry: 'tester' })]);
  });

  it('refuses without a signed-in console session', async () => {
    await expect(catalogueWith(undefined).then((response) => response.status)).resolves.toBe(401);
    await expect(catalogueWith('aeolus_session=forged').then((response) => response.status)).resolves.toBe(401);
  });

  it('shows a version tagged since, after a refresh', async () => {
    const cookie = await signIn();
    await git('tag', 'tester@2');

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
