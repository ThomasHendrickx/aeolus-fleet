import type { FleetScope, LabelValueId, MessageId, ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { AppRouter } from '../src/index.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { FLEET_URL, operatorCaller, secretOf, SESSION_MODEL } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { createTestClock } from './support/postgres-core.js';
import { refusalOf, unwrap } from '../src/testing/result.js';
import { refusedShip } from './support/refused-sender.js';
import { withOperatorLogin } from './support/operator-login.js';

// Read reach from HTTP to Postgres and back (decision 0034): reader, with
// fleet:read, and near carry team a; far carries team b; the applied read
// rule lets team a read team a, and every ship still sends to and manages
// every ship. Each
// fleet:read procedure answers reader only what the record allows.

const clock = createTestClock('2026-10-18T09:00:00.000Z');

let database: PrismaClient;
let server: FastifyInstance;
let address: string;
let useCases: UseCases;
let argo: ShipCaller;
let reader: TRPCClient<AppRouter>;
let plugin: { crewToken: string; on: (shipId: string) => TRPCClient<AppRouter> };
let readerNamingNear: TRPCClient<AppRouter>;
let ids: { reader: ShipId; near: ShipId; far: ShipId; trierarch: ShipId; networking: ShipId; ghost: ShipId };
let teamB: LabelValueId;
let farToNear: MessageId;
let farToArgo: MessageId;
let readerFrom: number;

function client(crewToken: string, headers: Record<string, string> = {}): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers: { ...headers, authorization: `Bearer ${crewToken}` } })] });
}

/** The header a plugin names the ship it reads for with (decision 0034). */
const ON_BEHALF_OF = 'aeolus-on-behalf-of';

/** A ship argo commissions and a session claims: its id, the caller it is and its crew token. */
async function crewed(ship: { name: string; type: string; fleetScopes?: FleetScope[] }): Promise<{ shipId: ShipId; caller: ShipCaller; crewToken: string }> {
  const { name, type, fleetScopes = [] } = ship;
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type, scopes: fleetScopes }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return { shipId, caller: unwrap(await useCases.authenticate.byCrewToken(crewToken)), crewToken };
}

async function send(from: ShipCaller, to: ShipId | { type: string }): Promise<MessageId> {
  clock.advance(1_000);
  const selector = typeof to === 'string' ? { kind: 'ship' as const, shipId: to } : { kind: 'type' as const, type: to.type };
  return unwrap(await useCases.sendMessage(from, { selector, payload: 'Review the pull request', contentType: 'text/plain', ...(from.kind === 'operator' ? {} : { model: SESSION_MODEL }), idempotencyKey: newKey() })).messageId;
}

async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
    return undefined;
  } catch (error) {
    return error instanceof TRPCClientError ? z.object({ code: z.string() }).parse(error.data).code : 'not a tRPC error';
  }
}

beforeAll(async () => {
  const databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma: database, clock });
  argo = operatorCaller(unwrap(await withOperatorLogin(database, useCases.initialiseFleet({ name: 'home fleet' }))));
  server = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false });
  address = await server.listen({ host: '127.0.0.1', port: 0 });

  // argo labels the ships: it labels any ship (decision 0046).
  const labeller = { caller: argo };
  const readerShip = await crewed({ name: 'reader', type: 'reader', fleetScopes: ['fleet:read'] });
  const near = await crewed({ name: 'near', type: 'reviewer' });
  const far = await crewed({ name: 'far', type: 'keeper' });
  const ghost = await crewed({ name: 'ghost', type: 'ghost' });
  const trierarch = await crewed({ name: 'mac-mini', type: 'trierarch', fleetScopes: ['crew:run'] });
  const networking = await crewed({ name: 'networking', type: 'networking', fleetScopes: ['fleet:network'] });
  const squadrons = await crewed({ name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:on-behalf'] });
  plugin = { crewToken: squadrons.crewToken, on: (shipId) => client(squadrons.crewToken, { [ON_BEHALF_OF]: shipId }) };
  ids = { reader: readerShip.shipId, near: near.shipId, far: far.shipId, trierarch: trierarch.shipId, networking: networking.shipId, ghost: ghost.shipId };
  reader = client(readerShip.crewToken);
  readerNamingNear = client(readerShip.crewToken, { [ON_BEHALF_OF]: near.shipId });

  const team = unwrap(await useCases.defineLabel(labeller.caller, { key: 'team', values: ['a', 'b'] }));
  const [teamA, b] = team.values.map((value) => value.id);
  if (teamA === undefined || b === undefined) {
    throw new Error('the team label has no values a and b');
  }
  teamB = b;
  for (const [shipId, valueId] of [
    [readerShip.shipId, teamA],
    [near.shipId, teamA],
    [far.shipId, teamB],
  ] as const) {
    unwrap(await useCases.assignLabel(labeller.caller, { shipId, valueId }));
  }
  const { savedAgainstVersion } = unwrap(await useCases.saveNetworkRulesDraft(networking.caller, { rules: [{ verb: 'read', from: [teamA], to: [teamA] }, { verb: 'send', from: [], to: [] }, { verb: 'manage', from: [], to: [] }] }));
  unwrap(await useCases.applyNetworkRules(networking.caller, { version: savedAgainstVersion }));

  ({ lastSeq: readerFrom } = unwrap(await useCases.followFleet(argo, {})));
  farToNear = await send(far.caller, near.shipId);
  farToArgo = await send(far.caller, argo.shipId);
  await send(near.caller, { type: 'ghost' });
  await send(argo, { type: 'ghost' });
  unwrap(await useCases.retireShip(argo, { shipId: ghost.shipId }));
  for (const shipId of [near.shipId, far.shipId]) {
    unwrap(await useCases.requestWorktreeClear(argo, { trierarchShipId: trierarch.shipId, shipId, repository: 'aeolus-fleet' }));
  }
});

afterAll(async () => {
  await server.close();
  await database.$disconnect();
});

describe('the fleet:read procedures for a ship outside read reach (decision 0034)', () => {
  it('fleet.list shows far by its name, type and status only, near whole', async () => {
    const listed = await reader.fleet.list.query();

    expect([listed.find((ship) => ship.id === ids.far), listed.find((ship) => ship.id === ids.near)]).toEqual([
      { id: ids.far, name: 'far', type: 'keeper', status: 'crewed', isInReadReach: false },
      expect.objectContaining({ id: ids.near, labels: [expect.objectContaining({ key: 'team', value: 'a' })] }),
    ]);
  });

  it('fleet.list matches no label value on far', async () => {
    await expect(reader.fleet.list.query({ valueIds: [teamB] })).resolves.toEqual([]);
  });

  it('fleet.ship shows far by its name, type and status only', async () => {
    await expect(reader.fleet.ship.query({ shipId: ids.far })).resolves.toEqual({ id: ids.far, name: 'far', type: 'keeper', status: 'crewed', isInReadReach: false });
  });

  it("fleet.labels and fleet.findLabelValue answer the fleet's labels whole: a ship's carried labels are what reach hides", async () => {
    const labels = await reader.fleet.labels.query();

    expect([labels.map((label) => label.key), await reader.fleet.findLabelValue.query({ key: 'team', value: 'b' })]).toEqual([['team'], expect.objectContaining({ valueId: teamB })]);
  });

  it("fleet.limits answers the fleet's limits whole", async () => {
    const limits = await reader.fleet.limits.query();

    expect(limits.ships.count).toBe(await database.ship.count({ where: { retiredAt: null } }));
  });

  it("fleet.shipTimeline answers far's events of the messages it reads only", async () => {
    const { items: timeline } = await reader.fleet.shipTimeline.query({ shipId: ids.far });

    expect(new Set(timeline.map((entry) => entry.message?.id ?? null))).toEqual(new Set([farToNear]));
  });

  it("fleet.shipMessages answers far's messages it reads through near only", async () => {
    const { items: messages } = await reader.fleet.shipMessages.query({ shipId: ids.far });

    expect(messages.map((message) => message.id)).toEqual([farToNear]);
  });

  it('fleet.message answers a message it does not read as none', async () => {
    expect([await codeOf(reader.fleet.message.query({ messageId: farToArgo })), (await reader.fleet.message.query({ messageId: farToNear })).id]).toEqual(['NOT_FOUND', farToNear]);
  });

  it("fleet.shipWay refuses far's way, and the refusal is recorded with the verb read", async () => {
    const code = await codeOf(reader.fleet.shipWay.query({ shipId: ids.far }));

    const refusals = unwrap(await useCases.readReachRefusals(argo)).filter((refusal) => refusal.verb === 'read');
    expect([code, refusals.map(({ sender, recipient }) => [refusedShip(sender).id, recipient.kind === 'ship' ? recipient.ship.id : recipient.type])]).toEqual(['FORBIDDEN', [[ids.reader, ids.far]]]);
  });

  it('keeps a refused read on behalf with the plugin that asked beside the named ship, and a ship\'s own refused read with none', async () => {
    const onBehalf: ShipCaller = { fleetId: argo.fleetId, shipId: ids.reader, kind: 'agent', scopes: ['fleet:read'], askedBy: ids.networking };
    refusalOf(await useCases.readShipWay(onBehalf, { shipId: ids.far }));

    const refusals = unwrap(await useCases.readReachRefusals(argo)).filter((refusal) => refusal.verb === 'read');
    expect(refusals.map(({ sender, askedBy }) => [refusedShip(sender).id, askedBy && [askedBy.id, askedBy.name]])).toEqual([
      [ids.reader, [ids.networking, 'networking']],
      [ids.reader, null],
    ]);
  });

  it('fleet.health counts only the deliveries whose message it reads', async () => {
    const health = await reader.fleet.health.query();

    expect(health.stuck.map((place) => place.count)).toEqual([1]);
  });

  it('fleet.needsAttention answers nothing it does not read', async () => {
    await expect(reader.fleet.needsAttention.query()).resolves.toEqual([]);
  });

  it('fleet.follow answers only the events it reads', async () => {
    const followed = await reader.fleet.follow.query({ afterSeq: readerFrom });

    expect(followed.events.some((event) => event.messageId === farToArgo)).toBe(false);
  });

  it('fleet.clearRequests answers only the requests for the ships it reads', async () => {
    const requests = await reader.fleet.clearRequests.query();

    expect(requests.map((request) => request.shipId)).toEqual([ids.near]);
  });

  it('fleet.inbox answers its own inbox only', async () => {
    await expect(reader.fleet.inbox.query({ filter: 'all' })).resolves.toEqual([]);
  });

  it('fleet.reachRefusals and fleet.explainReach need fleet:explain, which reader does not hold (decision 0053)', async () => {
    await expect(Promise.all([codeOf(reader.fleet.reachRefusals.query()), codeOf(reader.fleet.explainReach.query({ fromShipId: ids.reader }))])).resolves.toEqual(['FORBIDDEN', 'FORBIDDEN']);
  });

  it('argo reads far whole through its built-in rule', async () => {
    const ship = unwrap(await useCases.getShip(argo, { shipId: ids.far }));

    expect(ship).toMatchObject({ id: ids.far, kind: 'agent' });
  });
});

describe('a plugin reading on behalf of a named ship over HTTP (decision 0034)', () => {
  it('answers every fleet:read query on behalf of reader as reader reads it itself', async () => {
    const asked = (as: TRPCClient<AppRouter>) =>
      Promise.all([
        as.fleet.list.query(),
        as.fleet.ship.query({ shipId: ids.far }),
        as.fleet.ship.query({ shipId: ids.near }),
        as.fleet.shipTimeline.query({ shipId: ids.far }),
        as.fleet.shipMessages.query({ shipId: ids.far }),
        as.fleet.message.query({ messageId: farToNear }),
        codeOf(as.fleet.message.query({ messageId: farToArgo })),
        codeOf(as.fleet.shipWay.query({ shipId: ids.far })),
        as.fleet.health.query(),
        as.fleet.needsAttention.query(),
        as.fleet.clearRequests.query(),
        as.fleet.inbox.query({ filter: 'all' }),
        as.fleet.follow.query({ afterSeq: readerFrom }),
      ]);

    expect(await asked(plugin.on(ids.reader))).toEqual(await asked(reader));
  });

  it("reads with the named ship's read reach whatever its own scopes: near holds no fleet:read and reads reader whole, far by name, type and status only", async () => {
    const onBehalf = plugin.on(ids.near);

    const [whole, far] = [await onBehalf.fleet.ship.query({ shipId: ids.reader }), await onBehalf.fleet.ship.query({ shipId: ids.far })];

    expect([whole, far]).toEqual([
      expect.objectContaining({ id: ids.reader, labels: [expect.objectContaining({ key: 'team', value: 'a' })] }),
      { id: ids.far, name: 'far', type: 'keeper', status: 'crewed', isInReadReach: false },
    ]);
  });

  it('answers on the REST door too', async () => {
    const response = await fetch(`${address}/api/v1/fleet/ship`, {
      method: 'POST',
      headers: { authorization: `Bearer ${plugin.crewToken}`, [ON_BEHALF_OF]: ids.near, 'content-type': 'application/json' },
      body: JSON.stringify({ shipId: ids.reader }),
    });

    await expect(response.json()).resolves.toEqual(expect.objectContaining({ id: ids.reader, labels: [expect.objectContaining({ key: 'team', value: 'a' })] }));
  });

  it('refuses the header on a call that is no fleet:read read, and a header that names no ship id, as bad requests', async () => {
    await expect(Promise.all([codeOf(plugin.on(ids.near).ship.whoami.query()), codeOf(plugin.on('scout').fleet.list.query())])).resolves.toEqual(['BAD_REQUEST', 'BAD_REQUEST']);
  });

  it('refuses a ship without fleet:on-behalf, which reads only as itself, as forbidden', async () => {
    await expect(codeOf(readerNamingNear.fleet.ship.query({ shipId: ids.near }))).resolves.toBe('FORBIDDEN');
  });

  it('refuses to read on behalf of argo as forbidden, and of a retired ship as not found', async () => {
    await expect(Promise.all([codeOf(plugin.on(argo.shipId).fleet.list.query()), codeOf(plugin.on(ids.ghost).fleet.list.query())])).resolves.toEqual(['FORBIDDEN', 'NOT_FOUND']);
  });
});
