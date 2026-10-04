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
const STAND_DOWN = 'application/vnd.aeolus.squadron.stand-down+json';
const STOOD_DOWN = 'application/vnd.aeolus.squadron.stood-down+json';
/** Longer than several flagship rescans of 200 ms. */
const RESCANS_MS = 1_000;
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
  write('.aeolus/squadrons/templates/tester.yaml', 'description: Tests.\ncheckIn: 30m\nmodel: claude-opus-5-5\nlaunchNote: Start in the repository root.\ncharter: You test.\n');
  write(
    '.aeolus/squadrons/blueprints/team.yaml',
    `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\n`,
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
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: 500 });
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
      members: z.array(z.object({ shipId: z.string(), name: z.string(), role: z.string(), crewLines: z.array(z.object({ harness: z.string(), line: z.string() })), launchNote: z.string().nullable(), model: z.string().nullable() })),
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
    body: JSON.stringify({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  });
  const { crewToken } = z.object({ crewToken: z.string() }).parse(await registered.json());
  const call = async (operation: 'send' | 'receive' | 'ack', body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(`${fleetUrl}/api/v1/ship/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
      // A member's session states its model on every send.
      body: JSON.stringify(operation === 'send' ? { model: 'claude-opus-5-5', ...body } : body),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  return { call };
}

const deliveriesSchema = z.object({
  deliveries: z.array(z.object({ deliveryId: z.string(), messageId: z.string(), contentType: z.string(), payload: z.string(), model: z.string().nullable(), inReplyTo: z.string().nullable() })),
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
    const member = await crewedMember(formed.members[0]?.crewLines[0]?.line ?? '');

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
    // The flagship is squadrons' own ship: it states the package and the version it runs as its model.
    expect(role?.model).toMatch(/^@aeolus-fleet\/squadrons@\d+\.\d+\.\d+/);
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

  it('shows a model mismatch on a member that checks in stating another model than its template pins', async () => {
    const formed = await formTeam('team-two');
    expect(formed.members[0]?.model).toBe('claude-opus-5-5');
    const member = await crewedMember(formed.members[0]?.crewLines[0]?.line ?? '');

    await member.call('send', {
      selector: { kind: 'ship', name: 'team-two' },
      contentType: CHECK_IN,
      payload: JSON.stringify({ squadron: 'team-two', model: 'claude-sonnet-5-5' }),
      idempotencyKey: 'check-in-2',
    });

    await expect
      .poll(
        async () => {
          const listed = z
            .object({ result: z.object({ data: z.array(z.object({ id: z.string(), members: z.array(z.object({ model: z.unknown() })) })) }) })
            .parse(await (await fetch(`${address}/trpc/squadrons.list`, { headers: { cookie } })).json());
          return listed.result.data.find((squadron) => squadron.id === 'team-two')?.members[0]?.model;
        },
        { timeout: LIVE_TIMEOUT_MS },
      )
      .toEqual({ pinned: 'claude-opus-5-5', stated: 'claude-sonnet-5-5', isMismatch: true });
  });
});

describe('a message the flagship does not handle', () => {
  it('is kept for the squadron page, and argo is told of it in its inbox', async () => {
    const formed = await formTeam('team-two');
    const member = await crewedMember(formed.members[0]?.crewLines[0]?.line ?? '');

    await member.call('send', { selector: { kind: 'ship', name: 'team-two' }, payload: 'Can I take the login task?', idempotencyKey: 'plain-1' });

    const keptSchema = z.object({ result: z.object({ data: z.array(z.object({ payload: z.string(), contentType: z.string(), senderName: z.string() })) }) });
    await expect
      .poll(
        async () =>
          keptSchema.parse(await (await fetch(`${address}/trpc/squadrons.messages?input=${encodeURIComponent(JSON.stringify({ squadronId: 'team-two' }))}`, { headers: { cookie } })).json())
            .result.data.map((message) => message.payload),
        { timeout: LIVE_TIMEOUT_MS },
      )
      .toEqual(['Can I take the login task?']);
    const argo = await fleetDatabase.ship.findFirstOrThrow({ where: { kind: 'operator' } });
    await expect
      .poll(async () => (await fleetDatabase.message.findMany({ where: { selectorShipId: argo.id } })).map((message) => message.payload).join('\n'), {
        timeout: LIVE_TIMEOUT_MS,
      })
      .toContain('The flagship of the squadron team-two got a message it does not handle');
  });
});

describe('standing a squadron down', () => {
  it('sends the member its stand-down, retires it once it stood down, then retires the flagship: the squadron is disbanded', async () => {
    const formed = await formTeam('team-three');
    const member = await crewedMember(formed.members[0]?.crewLines[0]?.line ?? '');
    await member.call('send', {
      selector: { kind: 'ship', name: 'team-three' },
      contentType: ON_STATION,
      payload: JSON.stringify({ squadron: 'team-three', role: 'tester' }),
      idempotencyKey: 'on-station-3',
    });
    await expect.poll(() => squadronState('team-three'), { timeout: LIVE_TIMEOUT_MS }).toBe('sailing');

    const stood = await fetch(`${address}/trpc/squadrons.standDown`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ squadronId: 'team-three' }),
    });
    expect(stood.status, await stood.clone().text()).toBe(200);
    expect(await squadronState('team-three')).toBe('standing-down');

    let standDown: z.infer<typeof deliveriesSchema>['deliveries'][number] | undefined;
    await expect
      .poll(
        async () => {
          const { deliveries } = deliveriesSchema.parse(await member.call('receive', {}));
          standDown = deliveries.find((delivery) => delivery.contentType === STAND_DOWN) ?? standDown;
          return standDown !== undefined;
        },
        { timeout: LIVE_TIMEOUT_MS },
      )
      .toBe(true);
    expect(JSON.parse(standDown?.payload ?? '{}')).toEqual({ squadron: 'team-three' });
    expect(await squadronState('team-three')).toBe('standing-down');

    await member.call('ack', { deliveryId: standDown?.deliveryId });
    await new Promise((resolve) => setTimeout(resolve, RESCANS_MS));
    expect(await squadronState('team-three')).toBe('standing-down');

    await member.call('send', {
      selector: { kind: 'ship', name: 'team-three' },
      contentType: STOOD_DOWN,
      payload: JSON.stringify({ squadron: 'team-three' }),
      inReplyTo: standDown?.messageId,
      idempotencyKey: 'stood-down-3',
    });

    await expect.poll(() => squadronState('team-three'), { timeout: LIVE_TIMEOUT_MS }).toBe('disbanded');
    const ships = await fleetDatabase.ship.findMany({ where: { id: { in: [formed.flagship.shipId, formed.members[0]?.shipId ?? ''] } } });
    expect(ships.map((ship) => ship.retiredAt !== null)).toEqual([true, true]);
  });

  it('refuses a squadron that is not sailing', async () => {
    await formTeam('team-four');

    const stood = await fetch(`${address}/trpc/squadrons.standDown`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ squadronId: 'team-four' }),
    });

    expect(stood.status).toBe(409);
  });
});

describe('forcing a stand down', () => {
  it('retires every member and the flagship of a forming squadron at once: the squadron is disbanded', async () => {
    const formed = await formTeam('team-five');

    const forced = await fetch(`${address}/trpc/squadrons.forceStandDown`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ squadronId: 'team-five' }),
    });

    expect(forced.status, await forced.clone().text()).toBe(200);
    expect(await squadronState('team-five')).toBe('disbanded');
    const ships = await fleetDatabase.ship.findMany({ where: { id: { in: [formed.flagship.shipId, formed.members[0]?.shipId ?? ''] } } });
    expect(ships.map((ship) => ship.retiredAt !== null)).toEqual([true, true]);
  });
});

describe('adding a member', () => {
  it('commissions a member of a sailing squadron, answers its crew lines with the squadron id once, and lists it not on station', async () => {
    const formed = await formTeam('team-six');
    const member = await crewedMember(formed.members[0]?.crewLines[0]?.line ?? '');
    await member.call('send', {
      selector: { kind: 'ship', name: 'team-six' },
      contentType: ON_STATION,
      payload: JSON.stringify({ squadron: 'team-six', role: 'tester' }),
      idempotencyKey: 'on-station-6',
    });
    await expect.poll(() => squadronState('team-six'), { timeout: LIVE_TIMEOUT_MS }).toBe('sailing');

    const response = await fetch(`${address}/trpc/squadrons.addMember`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ squadronId: 'team-six', role: 'tester' }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const added = z.object({ result: z.object({ data: z.object({ name: z.string(), crewLines: z.array(z.object({ harness: z.string(), line: z.string() })), launchNote: z.string().nullable() }) }) }).parse(await response.json()).result.data;
    expect(added.crewLines.map(({ harness, line }) => [harness, line.split(' ').at(-1)])).toEqual([
      ['claude-code', 'team-six'],
      ['codex', 'team-six'],
    ]);
    expect(added.launchNote).toBe('Start in the repository root.');
    const listed = z
      .object({ result: z.object({ data: z.array(z.object({ id: z.string(), state: z.string(), members: z.array(z.object({ name: z.string(), health: z.string() })) })) }) })
      .parse(await (await fetch(`${address}/trpc/squadrons.list`, { headers: { cookie } })).json())
      .result.data.find((squadron) => squadron.id === 'team-six');
    expect(listed?.state).toBe('sailing');
    expect(listed?.members.find((each) => each.name === added.name)?.health).toBe('not-on-station');
  });
});

describe('removing a member', () => {
  it('retires the member of a sailing squadron at once, and the list shows its ship retired', async () => {
    const formed = await formTeam('team-seven');
    const [first] = formed.members;
    const member = await crewedMember(first?.crewLines[0]?.line ?? '');
    await member.call('send', {
      selector: { kind: 'ship', name: 'team-seven' },
      contentType: ON_STATION,
      payload: JSON.stringify({ squadron: 'team-seven', role: 'tester' }),
      idempotencyKey: 'on-station-7',
    });
    await expect.poll(() => squadronState('team-seven'), { timeout: LIVE_TIMEOUT_MS }).toBe('sailing');

    const response = await fetch(`${address}/trpc/squadrons.removeMember`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ squadronId: 'team-seven', shipId: first?.shipId }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const ship = await fleetDatabase.ship.findUniqueOrThrow({ where: { id: first?.shipId } });
    expect(ship.retiredAt).not.toBeNull();
    const listed = z
      .object({ result: z.object({ data: z.array(z.object({ id: z.string(), state: z.string(), members: z.array(z.object({ crew: z.object({ status: z.string() }) })) })) }) })
      .parse(await (await fetch(`${address}/trpc/squadrons.list`, { headers: { cookie } })).json())
      .result.data.find((squadron) => squadron.id === 'team-seven');
    expect(listed?.state).toBe('sailing');
    expect(listed?.members.map((each) => each.crew.status)).toEqual(['retired']);
  });
});

describe("a member's new crew line", () => {
  it('releases the member from its session and answers a crew line with the squadron id, which claims the ship', async () => {
    const formed = await formTeam('team-eight');
    const [first] = formed.members;
    await crewedMember(first?.crewLines[0]?.line ?? '');

    const response = await fetch(`${address}/trpc/squadrons.newCrewLine`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ squadronId: 'team-eight', shipId: first?.shipId }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const answered = z.object({ result: z.object({ data: z.object({ crewLines: z.array(z.object({ harness: z.string(), line: z.string() })), launchNote: z.string().nullable(), model: z.string().nullable() }) }) }).parse(await response.json()).result.data;
    const [, , shipId = '', secret = '', squadronId] = answered.crewLines[0]?.line.split(' ') ?? [];
    expect(squadronId).toBe('team-eight');
    expect(answered).toMatchObject({ launchNote: 'Start in the repository root.', model: 'claude-opus-5-5' });
    const registered = await fetch(`${fleetUrl}/api/v1/ship/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
    });
    expect(registered.status).toBe(200);
  });
});
