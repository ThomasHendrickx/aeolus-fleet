import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../core/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../core/src/adapters/prisma/client.js';
import { createUseCases } from '../../core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../../core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../core/test/support/database.js';
import { unwrap } from '../../core/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { createSquadronsDatabase } from './support/database.js';
import { startFakeGithub, tagsAt, type FakeGithub } from './support/fake-github.js';
import { seedRepository } from './support/repositories.js';
import { newKey } from '../../core/test/support/keys.js';

// Forming a squadron at squadrons' API against a real fleet: its flagship and
// members become ships of the fleet, the flagship crewed by squadrons, each
// member's crew line claims its ship, and squadrons lists the squadron forming.

const REPO = 'github.com/acme/templates';

let github: FakeGithub;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let app: SquadronsApp;
let address: string;
let cookie: string;
let fleetUseCases: ReturnType<typeof createUseCases>;
let argo: ReturnType<typeof operatorCaller>;

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
  github = await startFakeGithub();
  github.repositories.set('acme/templates', {
    tags: tagsAt(
      {
        files: {
          '.aeolus/squadrons/templates/tester.yaml': 'description: Tests.\ncheckIn: 30m\nlaunchNote: Start in the repository root.\ncharter: You test.\n',
          '.aeolus/squadrons/blueprints/team.yaml': `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\n    count: 2\n`,
        },
      },
      'tester@1', 'team@1',
    ),
  });

  const fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  const useCases = createUseCases({ prisma: fleetDatabase });
  fleetUseCases = useCases;
  argo = operatorCaller(unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
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
  await app.refreshCatalogue();
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  cookie = await signIn();
});

afterEach(async () => {
  await app.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  await github.close();
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

async function formTeam(squadronId?: string, more: Record<string, unknown> = {}) {
  const response = await fetch(`${address}/trpc/squadrons.form`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ blueprint: { repository: REPO, name: 'team', version: 1 }, ...(squadronId === undefined ? {} : { squadronId }), ...more }),
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

describe('crew requests at forming (#343)', () => {
  it("writes a crew request for each member the form gives a workspace, with the squadron and its machine labels as the fleet's value ids", async () => {
    const os = unwrap(await fleetUseCases.defineLabel(argo, { key: 'os', values: ['macos'] }));

    const formed = await formTeam('team-crewed', {
      members: { 'tester-1': { crew: { workspace: { kind: 'worktree', repository: 'hemma' }, machineLabels: [{ key: 'os', value: 'macos' }] } } },
    });

    const [first] = formed.members;
    await expect(fleetDatabase.crewRequest.findMany({ select: { shipId: true, settings: true } })).resolves.toEqual([
      { shipId: first?.shipId, settings: { workspace: { kind: 'worktree', repository: 'hemma' }, options: {}, squadron: 'team-crewed', machineLabels: [os.values[0]?.id] } },
    ]);
  });
});

describe('parameter values at the forming API (#371)', () => {
  it('refuses a parameter value over 1 KB, and forms nothing', async () => {
    const response = await fetch(`${address}/trpc/squadrons.form`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ blueprint: { repository: REPO, name: 'team', version: 1 }, members: { 'tester-1': { parameters: { area: 'x'.repeat(1025) } } } }),
    });

    expect(response.status).toBe(400);
    await expect(fleetDatabase.ship.count({ where: { type: 'flagship' } })).resolves.toBe(0);
  });

  it('forms with a parameter value of exactly 1 KB', async () => {
    const response = await fetch(`${address}/trpc/squadrons.form`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ blueprint: { repository: REPO, name: 'team', version: 1 }, members: { 'tester-1': { parameters: { area: 'x'.repeat(1024) } } } }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
  });
});
