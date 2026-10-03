import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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

// Forming killed midway, then squadrons started again on the same database: the
// start retires every ship the killed forming commissioned, the one whose id it
// never heard back included, and no squadron is left half formed.

const run = promisify(execFile);
const REPO = 'example.com/templates';
// The flagship, then two members: the third commission is the one the crash swallows.
const COMMISSION_THAT_HANGS = 3;

let work: string;
let origin: string;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let proxy: Server;
let squadronsDatabaseUrl: string;
let managementShip: { shipId: ShipId; secret: string };
let killed: SquadronsApp;
let restarted: SquadronsApp | undefined;
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

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(z.instanceof(Uint8Array).parse(chunk)));
  }
  return Buffer.concat(chunks);
}

/**
 * Passes squadrons' calls to the fleet, but the given commission reaches the
 * fleet and its answer never comes back: the process dies there, after the
 * fleet made the ship and before squadrons recorded its id.
 */
function startCrashingProxy(onHang: () => void): Promise<string> {
  let commissions = 0;
  proxy = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const body = await bodyOf(request);
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !['host', 'connection', 'content-length'].includes(name)).map(([name, value]) => [name, String(value)]));
      const answered = await fetch(`${fleetUrl}${request.url ?? ''}`, { method: request.method, headers, ...(body.length > 0 ? { body } : {}) });
      if (request.url === '/api/v1/fleet/commission' && ++commissions === COMMISSION_THAT_HANGS) {
        onHang();
        return;
      }
      response.writeHead(answered.status, { 'content-type': answered.headers.get('content-type') ?? 'application/json' });
      response.end(Buffer.from(await answered.arrayBuffer()));
    })();
  });
  return new Promise((resolve) => {
    proxy.listen(0, '127.0.0.1', () => {
      const address = proxy.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`);
    });
  });
}

function squadronsApp(through: string): SquadronsApp {
  return createSquadronsApp({
    databaseUrl: squadronsDatabaseUrl,
    fleetUrl: through,
    managementShip,
    repositories: [{ url: `file://${origin}`, name: REPO, path: undefined, token: undefined }],
    cacheDir: join(work, 'cache'),
    logger: false,
  });
}

beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), 'aeolus-crash-safe-forming-'));
  origin = join(work, 'templates');
  mkdirSync(origin);
  await git('init', '--quiet', '--initial-branch=main');
  write('squadrons/templates/tester.yaml', 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n');
  write('squadrons/blueprints/team.yaml', `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\n    count: 3\nentry: tester\n`);
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
  managementShip = { shipId, secret: secretIn(prompt) };
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });
  cookie = await signIn();
  squadronsDatabaseUrl = await createSquadronsDatabase();
});

afterEach(async () => {
  proxy.closeAllConnections();
  proxy.close();
  // The test's own request to the killed app keeps its connection alive, which close would wait out.
  killed.server.server.closeAllConnections();
  await killed.close();
  await restarted?.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  rmSync(work, { recursive: true, force: true });
});

async function shipsOtherThanArgoAndSquadrons() {
  return fleetDatabase.ship.findMany({ where: { name: { notIn: ['argo', 'squadrons'] } }, select: { name: true, retiredAt: true } });
}

describe('forming that a crash kills midway', () => {
  it('is undone by the next start: every ship it commissioned is retired, and no squadron is kept', async () => {
    let hung: () => void = () => undefined;
    const reachedTheCrash = new Promise<void>((resolve) => {
      hung = resolve;
    });
    killed = squadronsApp(await startCrashingProxy(() => { hung(); }));
    unwrap(await killed.crewManagementShip());
    await killed.refreshCatalogue();
    const address = await killed.server.listen({ host: '127.0.0.1', port: 0 });
    void fetch(`${address}/trpc/squadrons.form`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ blueprint: { repository: REPO, name: 'team', version: 1 }, squadronId: 'team-one' }),
    }).catch(() => undefined);
    await reachedTheCrash;
    expect((await shipsOtherThanArgoAndSquadrons()).filter((ship) => ship.retiredAt === null)).toHaveLength(COMMISSION_THAT_HANGS);

    restarted = squadronsApp(fleetUrl);
    unwrap(await restarted.crewManagementShip());
    const recovered = unwrap(await restarted.recoverFormations());

    expect(recovered).toEqual({ recovered: 1, retired: COMMISSION_THAT_HANGS });
    expect((await shipsOtherThanArgoAndSquadrons()).every((ship) => ship.retiredAt !== null)).toBe(true);
    const listed = z
      .object({ result: z.object({ data: z.array(z.unknown()) }) })
      .parse(await (await fetch(`${await restarted.server.listen({ host: '127.0.0.1', port: 0 })}/trpc/squadrons.list`, { headers: { cookie } })).json());
    expect(listed.result.data).toEqual([]);
  });
});
