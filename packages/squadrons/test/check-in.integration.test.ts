import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

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

// The check-in against a real fleet: a member crewed with its crew line checks
// in at its flagship, gets its role and charter back, confirms it, and the
// squadron sails once every member is on station.

const run = promisify(execFile);
const REPO = 'example.com/templates';

let work: string;
let origin: string;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let app: SquadronsApp;
let address: string;
let cookie: string;
const ROLE = 'application/vnd.aeolus.squadron.role+json';
const CHECK_IN = 'application/vnd.aeolus.squadron.check-in+json';
const ON_STATION = 'application/vnd.aeolus.squadron.on-station+json';
/** A live change shows within this. */
const LIVE_TIMEOUT_MS = 20_000;

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
  const set = response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='));
  return z.string().parse(set).split(';')[0] ?? '';
}

beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), 'aeolus-forming-api-'));
  origin = join(work, 'templates');
  mkdirSync(origin);
  await git('init', '--quiet', '--initial-branch=main');
  write('squadrons/templates/tester.yaml', 'description: Tests.\ncheckIn: 30m\nlaunchNote: Start in the repository root.\ncharter: You test.\n');
  write(
    'squadrons/blueprints/team.yaml',
    `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\nentry: tester\n`,
  );
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
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: 500 });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });

  app = createSquadronsApp({
    databaseUrl: await createSquadronsDatabase(),
    fleetUrl,
    managementShip: { shipId, secret: secretIn(prompt) },
    repositories: [{ url: `file://${origin}`, name: REPO, path: undefined, token: undefined }],
    cacheDir: join(work, 'cache'),
    logger: false,
  });
  unwrap(await app.crewManagementShip());
  await app.refreshCatalogue();
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  app.startFlagships(200);
  cookie = await signIn();
});

afterEach(async () => {
  await app.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  rmSync(work, { recursive: true, force: true });
});

const formedSchema = z.object({
  result: z.object({
    data: z.object({
      squadronId: z.string(),
      flagship: z.object({ shipId: z.string(), name: z.string() }),
      members: z.array(z.object({ shipId: z.string(), name: z.string(), role: z.string(), crewLine: z.string(), launchNote: z.string().nullable() })),
    }),
  }),
});

async function formTeam(squadronId?: string) {
  const response = await fetch(`${address}/trpc/squadrons.form`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ blueprint: { repository: REPO, name: 'team', version: 1 }, ...(squadronId === undefined ? {} : { squadronId }) }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return formedSchema.parse(await response.json()).result.data;
}


/** A member's session over the fleet's REST API, crewed with the crew line squadrons gave it. */
async function crewedMember(crewLine: string) {
  const [, , shipId = '', secret = ''] = crewLine.split(' ');
  const registered = await fetch(`${fleetUrl}/api/v1/ship/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shipId, secret, location: { kind: 'DEVICE' } }),
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(await registered.json());
  const call = async (operation: 'send' | 'receive' | 'ack', body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(`${fleetUrl}/api/v1/ship/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
      body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  return { call };
}

const deliveriesSchema = z.object({
  deliveries: z.array(z.object({ deliveryId: z.string(), messageId: z.string(), contentType: z.string(), payload: z.string(), inReplyTo: z.string().nullable() })),
});

async function squadronState(squadronId: string): Promise<string | undefined> {
  const listed = z
    .object({ result: z.object({ data: z.array(z.object({ id: z.string(), state: z.string() })) }) })
    .parse(await (await fetch(`${address}/trpc/squadrons.list`, { headers: { cookie } })).json());
  return listed.result.data.find((squadron) => squadron.id === squadronId)?.state;
}

describe('the check-in at the flagship', () => {
  it("answers a member's check-in with its role and charter, and sails the squadron when the member confirms", async () => {
    const formed = await formTeam('team-one');
    const member = await crewedMember(formed.members[0]?.crewLine ?? '');

    await member.call('send', {
      selector: { kind: 'ship', name: 'team-one' },
      contentType: CHECK_IN,
      payload: JSON.stringify({ squadron: 'team-one' }),
      idempotencyKey: 'check-in-1',
    });
    let role: z.infer<typeof deliveriesSchema>['deliveries'][number] | undefined;
    await expect
      .poll(
        async () => {
          const { deliveries } = deliveriesSchema.parse(await member.call('receive', {}));
          role = deliveries.find((delivery) => delivery.contentType === ROLE) ?? role;
          return role !== undefined;
        },
        { timeout: LIVE_TIMEOUT_MS },
      )
      .toBe(true);
    await member.call('ack', { deliveryId: role?.deliveryId });

    expect(JSON.parse(role?.payload ?? '{}')).toMatchObject({ squadron: 'team-one', role: 'tester', template: 'tester@1', charter: 'You test.', checkIn: '30m' });
    expect(await squadronState('team-one')).toBe('forming');

    await member.call('send', {
      selector: { kind: 'ship', name: 'team-one' },
      contentType: ON_STATION,
      payload: JSON.stringify({ squadron: 'team-one', role: 'tester' }),
      inReplyTo: role?.messageId,
      idempotencyKey: 'on-station-1',
    });

    await expect.poll(() => squadronState('team-one'), { timeout: LIVE_TIMEOUT_MS }).toBe('sailing');
  });
});
