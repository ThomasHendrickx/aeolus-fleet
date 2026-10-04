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
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../../server/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../server/test/support/database.js';
import { unwrap } from '../../server/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { createSquadronsDatabase } from './support/database.js';
import { seedRepository } from './support/repositories.js';
import { newKey } from '../../server/test/support/keys.js';

// Forming a squadron at squadrons' API against a real fleet: its flagship and
// members become ships of the fleet, the flagship crewed by squadrons, each
// member's crew line claims its ship, and squadrons lists the squadron forming.

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
  write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\ncheckIn: 30m\nlaunchNote: Start in the repository root.\ncharter: You test.\n');
  write(
    '.aeolus/squadrons/blueprints/team.yaml',
    `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\n    count: 2\n`,
  );
  await git('add', '.');
  await git('commit', '--quiet', '-m', 'team');
  await git('tag', 'tester@1');
  await git('tag', 'team@1');

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
  await seedRepository(squadronsDatabaseUrl, { fleetId: argo.fleetId, name: REPO, url: `file://${origin}` });
  app = createSquadronsApp({
    databaseUrl: squadronsDatabaseUrl,
    fleetUrl,
    cacheDir: join(work, 'cache'),
    logger: false,
  });
  unwrap(await app.connect({ operatorFleetId: argo.fleetId, shipId, secret: secretOf(secret) }));
  await app.refreshCatalogue();
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
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
      members: z.array(z.object({ shipId: z.string(), name: z.string(), role: z.string(), crewLines: z.array(z.object({ harness: z.string(), line: z.string() })), launchNote: z.string().nullable() })),
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

describe('forming a squadron at the squadrons API', () => {
  it('makes the flagship and the members ships of the fleet, the flagship crewed by squadrons', async () => {
    const formed = await formTeam('team-one');

    const ships = await fleetDatabase.ship.findMany({ where: { id: { in: [formed.flagship.shipId, ...formed.members.map((member) => member.shipId)] } } });
    expect(ships.map(({ name, type }) => ({ name, type })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'team-one', type: 'flagship' },
      ...formed.members.map((member) => ({ name: member.name, type: 'team-one:tester' })).sort((a, b) => a.name.localeCompare(b.name)),
    ]);
    await expect(fleetDatabase.lease.count({ where: { shipId: formed.flagship.shipId, endedAt: null } })).resolves.toBe(1);
  });

  it("gives each member a crew line that claims its ship, with the squadron id and the template's launch note", async () => {
    const [member] = (await formTeam('team-two')).members;
    const [, , shipId = '', secret = '', squadronId] = member?.crewLines[0]?.line.split(' ') ?? [];

    const registered = await fetch(`${fleetUrl}/api/v1/ship/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
    });

    expect(registered.status).toBe(200);
    expect(squadronId).toBe('team-two');
    expect(member?.launchNote).toBe('Start in the repository root.');
  });

  it('lists the squadron forming, with its members off station, awaiting crew, and their check-in interval', async () => {
    const formed = await formTeam();

    const listed = z
      .object({
        result: z.object({
          data: z.array(
            z.object({
              id: z.string(),
              state: z.string(),
              members: z.array(
                z.object({
                  name: z.string(),
                  onStationAt: z.string().nullable(),
                  health: z.string(),
                  checkInMinutes: z.number(),
                  crew: z.object({ status: z.string(), lastSeenAt: z.string().nullable(), crewedSince: z.string().nullable() }),
                }),
              ),
            }),
          ),
        }),
      })
      .parse(await (await fetch(`${address}/trpc/squadrons.list`, { headers: { cookie } })).json());

    expect(formed.squadronId).toMatch(/^team-[a-z0-9]{6}$/);
    expect(listed.result.data.map(({ id, state }) => ({ id, state }))).toEqual([{ id: formed.squadronId, state: 'forming' }]);
    expect(listed.result.data[0]?.members.map(({ onStationAt, health, checkInMinutes, crew }) => ({ onStationAt, health, checkInMinutes, crew }))).toEqual([
      { onStationAt: null, health: 'not-on-station', checkInMinutes: 30, crew: { status: 'awaitingCrew', lastSeenAt: null, crewedSince: null } },
      { onStationAt: null, health: 'not-on-station', checkInMinutes: 30, crew: { status: 'awaitingCrew', lastSeenAt: null, crewedSince: null } },
    ]);
  });
});
