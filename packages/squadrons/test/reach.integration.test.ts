import type { FleetId, ShipId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../core/src/app.js';
import { createPrismaClient, type PrismaClient } from '../../core/src/adapters/prisma/client.js';
import { createUseCases } from '../../core/src/wiring.js';
import { FLEET_URL, OPERATOR, operatorCaller, secretOf } from '../../core/test/support/core-fixtures.js';
import { createMigratedDatabase } from '../../core/test/support/database.js';
import { newKey } from '../../core/test/support/keys.js';
import { unwrap } from '../../core/test/support/result.js';
import { createSquadronsApp, type SquadronsApp } from '../src/app.js';
import { signIn } from './support/connection.js';
import { createSquadronsDatabase } from './support/database.js';
import { startFakeGithub, tagsAt, type FakeGithub } from './support/fake-github.js';
import { seedRepository } from './support/repositories.js';

// The squadron labels and declared network rules against a real fleet (#573,
// decision 0037): squadrons labels each squadron's ships and its own, declares
// their reach on the labels it owns, and withdraws it when switched off or
// deleted.

const TOKEN = 'an-installation-token-of-at-least-32-characters';
const REPO = 'github.com/acme/templates';
/** How often squadrons rescans its flagships here: often, so a test waits briefly. */
const RESCAN_MS = 50;

let github: FakeGithub;
let fleetDatabaseUrl: string;
let fleetDatabase: PrismaClient;
let useCases: ReturnType<typeof createUseCases>;
let argo: ReturnType<typeof operatorCaller>;
let fleet: FastifyInstance;
let fleetUrl: string;
let app: SquadronsApp;
let address: string;
let fleetId: FleetId;
let management: { shipId: ShipId; secret: string };
let cookie: string;

function installation(procedure: string, body: unknown): Promise<Response> {
  return fetch(`${address}/trpc/${procedure}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aeolus-installation-token': TOKEN }, body: JSON.stringify(body) });
}

function asOperator(procedure: string, body: unknown): Promise<Response> {
  return fetch(`${address}/trpc/${procedure}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function expectOk(response: Promise<Response>): Promise<unknown> {
  const answered = await response;
  expect(answered.status, await answered.clone().text()).toBe(200);
  return z.object({ result: z.object({ data: z.unknown() }) }).parse(await answered.json()).result.data;
}

/** squadrons switched on for the fleet, connected, a squadron formed, and its flagships watched. */
async function aFormedSquadron(): Promise<{ flagship: ShipId; member: ShipId }> {
  await expectOk(installation('installation.setEnabled', { requestId: newKey(), fleetId, enabled: true }));
  await expectOk(asOperator('connection.connect', { shipId: management.shipId, secret: management.secret }));
  const formed = z
    .object({ flagship: z.object({ shipId: z.string() }), members: z.array(z.object({ shipId: z.string() })) })
    .parse(await expectOk(asOperator('squadrons.form', { blueprint: { repository: REPO, name: 'team', version: 1 }, squadronId: 'team-one' })));
  app.startFlagships(RESCAN_MS);
  const ids = (await useCases.listFleet(argo)).map((ship) => ship.id);
  const flagship = ids.find((id) => id === formed.flagship.shipId);
  const member = ids.find((id) => id === formed.members[0]?.shipId);
  if (flagship === undefined || member === undefined) {
    throw new Error('the squadron formed no flagship or member');
  }
  return { flagship, member };
}

/** The label values a ship carries, as `key=value`. */
async function labelsOf(shipId: ShipId): Promise<string[]> {
  const ship = (await useCases.listFleet(argo)).find((each) => each.id === shipId);
  return (ship?.labels ?? []).map((label) => `${label.key}=${label.value}`).sort();
}

/** Every rule the fleet holds declared, by the ship that declared it. */
async function declared(): Promise<{ shipId: string; rules: unknown[] }[]> {
  return (await useCases.readDeclaredNetworkRules(argo)).map(({ shipId, rules }) => ({ shipId, rules: [...rules] })).filter((each) => each.rules.length > 0);
}

/** The fleet down and up again on the same address: squadrons' calls meanwhile get no answer. */
async function fleetDown(): Promise<() => Promise<void>> {
  const { port } = new URL(fleetUrl);
  await fleet.close();
  return async () => {
    fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: 500 });
    await fleet.listen({ host: '127.0.0.1', port: Number(port) });
  };
}

/** Waits for a few rescans to pass. */
function severalRescans(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RESCAN_MS * 6));
}

beforeEach(async () => {
  github = await startFakeGithub();
  github.repositories.set('acme/templates', {
    tags: tagsAt(
      {
        files: {
          '.aeolus/squadrons/templates/tester.yaml': 'description: Tests.\ncheckIn: 30m\ncharter: You test.\n',
          '.aeolus/squadrons/blueprints/team.yaml': `description: A team.\nroles:\n  tester:\n    template: ${REPO}#tester@1\n`,
        },
      },
      'tester@1',
      'team@1',
    ),
  });
  fleetDatabaseUrl = await createMigratedDatabase();
  fleetDatabase = createPrismaClient(fleetDatabaseUrl);
  useCases = createUseCases({ prisma: fleetDatabase });
  const founded = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  argo = operatorCaller(founded);
  fleetId = founded.fleetId;
  const commissioned = unwrap(
    await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'squadrons', type: 'squadrons', fleetScopes: ['fleet:read', 'fleet:manage', 'labels:define', 'labels:assign'] }),
  );
  management = { shipId: commissioned.shipId, secret: secretOf(commissioned.secret) };
  fleet = createApp({ databaseUrl: fleetDatabaseUrl, publicUrl: FLEET_URL, logger: false, receiveWaitMs: 500 });
  fleetUrl = await fleet.listen({ host: '127.0.0.1', port: 0 });
  const squadronsDatabaseUrl = await createSquadronsDatabase();
  await seedRepository(squadronsDatabaseUrl, { fleetId, name: REPO, url: 'https://github.com/acme/templates' });
  app = createSquadronsApp({ databaseUrl: squadronsDatabaseUrl, fleetUrl, githubApiUrl: github.apiUrl, logger: false, installationToken: TOKEN });
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  cookie = await signIn(fleetUrl);
});

afterEach(async () => {
  await app.close();
  await fleet.close();
  await fleetDatabase.$disconnect();
  await github.close();
});

describe('the squadron reach against a real fleet (#573, decision 0037)', () => {
  it("labels a squadron's ships squadron=<id>, its flagship and own ship by squadron-role, and declares their reach once", async () => {
    const { flagship, member } = await aFormedSquadron();

    await expect.poll(() => declared()).toHaveLength(1);
    await expect.poll(() => labelsOf(member)).toEqual(['squadron=team-one']);
    await severalRescans();

    await expect(labelsOf(flagship)).resolves.toEqual(['squadron-role=flagship', 'squadron=team-one']);
    await expect(labelsOf(member)).resolves.toEqual(['squadron=team-one']);
    await expect(labelsOf(management.shipId)).resolves.toEqual(['squadron-role=squadrons']);
    const labels = await useCases.listLabels(argo);
    const squadron = z.string().parse(labels.find((label) => label.key === 'squadron')?.id);
    const valueOf = async (value: string) => unwrap(await useCases.findLabelValue(argo, { key: 'squadron-role', value })).valueId;
    const same = { labelId: squadron, value: '#' };
    await expect(declared()).resolves.toEqual([
      {
        shipId: management.shipId,
        rules: [
          { from: [same], to: [same] },
          { from: [await valueOf('flagship')], to: [await valueOf('squadrons')] },
          { from: [await valueOf('squadrons')], to: [await valueOf('flagship')] },
        ],
      },
    ]);
    await expect(fleetDatabase.event.count({ where: { type: 'NetworkRulesDeclared' } })).resolves.toBe(1);
  });

  it('withdraws the declared rules when switched off, keeping the labels, and declares them again once on', async () => {
    const { member } = await aFormedSquadron();
    await expect.poll(() => declared()).toHaveLength(1);
    // Two rescans may overlap: one may declare while the other still labels.
    await expect.poll(() => labelsOf(member)).toEqual(['squadron=team-one']);

    await expectOk(installation('installation.setEnabled', { requestId: newKey(), fleetId, enabled: false }));
    await expect(declared()).resolves.toEqual([]);
    await expect(labelsOf(member)).resolves.toEqual(['squadron=team-one']);

    await expectOk(installation('installation.setEnabled', { requestId: newKey(), fleetId, enabled: true }));
    await expect.poll(() => declared()).toHaveLength(1);
  });

  it('withdraws on a later rescan what a switch off could not, while the fleet did not answer', async () => {
    await aFormedSquadron();
    await expect.poll(() => declared()).toHaveLength(1);
    const fleetUp = await fleetDown();

    await expectOk(installation('installation.setEnabled', { requestId: newKey(), fleetId, enabled: false }));
    await fleetUp();

    await expect.poll(() => declared()).toEqual([]);
  });

  it('withdraws the declared rules before it forgets a deleted fleet, and refuses the delete while the fleet does not answer', async () => {
    await aFormedSquadron();
    await expect.poll(() => declared()).toHaveLength(1);
    const fleetUp = await fleetDown();

    expect((await installation('installation.delete', { requestId: newKey(), fleetId })).status).toBe(502);
    await fleetUp();
    await expect(declared()).resolves.toHaveLength(1);

    await expectOk(installation('installation.delete', { requestId: newKey(), fleetId }));
    await expect(declared()).resolves.toEqual([]);
  });
});
