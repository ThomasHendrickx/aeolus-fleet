import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { FleetId, ShipId } from '@aeolus-fleet/common';
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

// Forming killed midway, then squadrons started again on the same database: the
// start retires every ship the killed forming commissioned, the one whose id it
// never heard back included, and no squadron is left half formed.

const REPO = 'github.com/acme/templates';
// The flagship, then two members: the third commission is the one the crash swallows.
const COMMISSION_THAT_HANGS = 3;

let github: FakeGithub;
let fleetDatabase: PrismaClient;
let fleet: FastifyInstance;
let fleetUrl: string;
let proxy: Server;
let squadronsDatabaseUrl: string;
let managementShip: { operatorFleetId: FleetId; shipId: ShipId; secret: string };
let killed: SquadronsApp;
let restarted: SquadronsApp | undefined;
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

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(z.instanceof(Uint8Array).parse(chunk)));
  }
  return Buffer.concat(chunks);
}

/**
 * Passes squadrons' calls to the fleet, but the given commission reaches the
 * fleet and its answer never comes back. `hang`: the process dies there, after
 * the fleet made the ship and before squadrons recorded its id. `drop`: the
 * connection breaks, as a lost answer does, and squadrons goes on.
 */
function startCrashingProxy(onHang: () => void, behaviour: 'hang' | 'drop' = 'hang'): Promise<string> {
  let commissions = 0;
  proxy = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const body = await bodyOf(request);
      const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !['host', 'connection', 'content-length'].includes(name)).map(([name, value]) => [name, String(value)]));
      const answered = await fetch(`${fleetUrl}${request.url ?? ''}`, { method: request.method, headers, ...(body.length > 0 ? { body } : {}) });
      if (request.url === '/api/v1/fleet/commission' && ++commissions === COMMISSION_THAT_HANGS) {
        onHang();
        if (behaviour === 'drop') {
          response.destroy();
        }
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
    githubApiUrl: github.apiUrl,
    logger: false,
  });
}

beforeEach(async () => {
  github = await startFakeGithub();
  github.repositories.set('acme/templates', {
    tags: tagsAt(
      {
        files: {
          '.aeolus/squadrons/templates/tester.yaml': 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n',
          '.aeolus/squadrons/blueprints/team.yaml': `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\n    count: 3\n`,
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
  managementShip = { operatorFleetId: argo.fleetId, shipId, secret: secretOf(secret) };
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });
  cookie = await signIn();
  squadronsDatabaseUrl = await createSquadronsDatabase();
  await seedRepository(squadronsDatabaseUrl, { fleetId: argo.fleetId, name: REPO, url: 'https://github.com/acme/templates' });
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
  await github.close();
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
    unwrap(await killed.connect(managementShip));
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
    // The restart connects again with the crew token the killed process kept, and recovers the fleet's formations.
    const restored = await restarted.restoreConnections();

    expect(restored).toEqual([{ fleetId: managementShip.operatorFleetId, ship: 'squadrons', recovered: 1, retired: COMMISSION_THAT_HANGS }]);
    expect((await shipsOtherThanArgoAndSquadrons()).every((ship) => ship.retiredAt !== null)).toBe(true);
    const listed = z
      .object({ result: z.object({ data: z.array(z.unknown()) }) })
      .parse(await (await fetch(`${await restarted.server.listen({ host: '127.0.0.1', port: 0 })}/trpc/squadrons.list`, { headers: { cookie } })).json());
    expect(listed.result.data).toEqual([]);
  });
});

describe('a commission whose answer is lost', () => {
  it('is asked again under the same key: forming goes on with one ship per name, each member crew line claiming its ship', async () => {
    killed = squadronsApp(await startCrashingProxy(() => undefined, 'drop'));
    unwrap(await killed.connect(managementShip));
    await killed.refreshCatalogue();
    const address = await killed.server.listen({ host: '127.0.0.1', port: 0 });

    const response = await fetch(`${address}/trpc/squadrons.form`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ blueprint: { repository: REPO, name: 'team', version: 1 }, squadronId: 'team-one' }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const formed = z
      .object({ result: z.object({ data: z.object({ members: z.array(z.object({ name: z.string(), crewLines: z.array(z.object({ harness: z.string(), line: z.string() })) })) }) }) })
      .parse(await response.json()).result.data;
    const ships = await shipsOtherThanArgoAndSquadrons();
    expect(ships.filter((ship) => ship.retiredAt === null)).toHaveLength(1 + formed.members.length);
    expect(new Set(ships.map((ship) => ship.name)).size).toBe(ships.length);
    for (const member of formed.members) {
      const [, , shipId = '', secret = ''] = member.crewLines[0]?.line.split(' ') ?? [];
      const registered = await fetch(`${fleetUrl}/api/v1/ship/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }),
      });
      expect(registered.status, member.name).toBe(200);
    }
  });
});
