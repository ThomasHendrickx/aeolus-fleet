import { readFile } from 'node:fs/promises';

import { FEATURE_FLAGS, SCOPES, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { createTRPCClient, httpBatchLink, TRPCClientError, type TRPCClient } from '@trpc/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import type { AppRouter } from '../src/index.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { refusalOf, unwrap } from '../src/testing/result.js';
import { FLEET_URL } from './support/core-fixtures.js';
import { createInMemoryKeyVault } from './support/in-memory-key-vault.js';
import type { KeyVaultWorld } from './support/key-vault-contract.js';
import { createTestClock } from './support/postgres-core.js';

// Feature flags (decision 0069) from the installation's call to Postgres and
// back: setting them, their events, the refusals, console.session, sealing
// refused while its flag is off, and the migration's start for fleets that
// were sealing before it.

const INSTALLATION_TOKEN = 'aeolus_installation_test_0123456789abcdef';
const SESSION_COOKIE = 'aeolus_session';
const RACES = 8;
const clock = createTestClock('2026-10-30T12:00:00.000Z');

let databaseUrl: string;
let database: PrismaClient;
let world: KeyVaultWorld;
let core: UseCases;
let hosting: FastifyInstance;
let address: string;

beforeAll(async () => {
  databaseUrl = await createMigratedDatabase();
  database = createPrismaClient(databaseUrl);
  world = createInMemoryKeyVault();
  core = createUseCases({ prisma: database, clock, keyVault: world.vault, hasInstallation: true });
  hosting = createApp({ databaseUrl, publicUrl: FLEET_URL, clock, logger: false, installationToken: INSTALLATION_TOKEN, keyVault: world.vault });
  address = await hosting.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await hosting.close();
  await database.$disconnect();
});

function client(headers: Record<string, string>): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${address}/trpc`, headers })] });
}

const installation = () => client({ 'x-aeolus-installation-token': INSTALLATION_TOKEN }).installation;

/** The tRPC error code and message a call fails with; undefined when it succeeds. */
async function refusalOfCall(call: Promise<unknown>): Promise<{ code: string | undefined; message: string } | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCClientError) {
      return { code: z.object({ code: z.string() }).safeParse(error.data).data?.code, message: error.message };
    }
    throw error;
  }
  return undefined;
}

/** A fleet the installation creates, with the flags asked for on. */
async function aFleet(name: string, featureFlags: 'sealing'[] = []): Promise<{ fleetId: FleetId; operatorShipId: ShipId }> {
  return installation().fleets.create.mutate({ requestId: newKey(), name, operatorEmail: `${name}@example.com`, featureFlags });
}

/** argo of a fleet as the caller, as its console session makes it. */
function argoOf(fleet: { fleetId: FleetId; operatorShipId: ShipId }): ShipCaller {
  return { fleetId: fleet.fleetId, shipId: fleet.operatorShipId, kind: 'operator', scopes: [...SCOPES] };
}

async function aKeyBoundTo(fleetId: FleetId): Promise<string> {
  const companyKey = await world.aCompanyKey();
  await world.bindToFleet(companyKey, fleetId);
  return companyKey;
}

async function flagRows(fleetId: FleetId): Promise<string[]> {
  return (await database.fleetFeatureFlag.findMany({ where: { fleetId } })).map(({ flag }) => flag);
}

async function flagEvents(fleetId: FleetId) {
  return (await database.event.findMany({ where: { fleetId, type: { in: ['FeatureFlagTurnedOn', 'FeatureFlagTurnedOff'] } }, orderBy: { seq: 'asc' } })).map(({ type, actorKind, details }) => ({ type, actorKind, details }));
}

describe('feature flags through the installation API on Postgres (decision 0069)', () => {
  it('lists the flags core names', async () => {
    await expect(installation().featureFlags.list.query()).resolves.toEqual(FEATURE_FLAGS);
  });

  it('creates a fleet with sealing on, turns it off and on again, each change with its event, and get and list answer it', async () => {
    const fleet = await aFleet('hemma', ['sealing']);
    expect(await flagRows(fleet.fleetId)).toEqual(['sealing']);

    await expect(installation().fleets.setFeatureFlag.mutate({ fleetId: fleet.fleetId, flag: 'sealing', isOn: false })).resolves.toEqual({ flag: 'sealing', isOn: false, canTurnOff: true });
    expect(await flagRows(fleet.fleetId)).toEqual([]);
    expect((await installation().fleets.get.query({ fleetId: fleet.fleetId })).featureFlags).toEqual([{ flag: 'sealing', isOn: false, canTurnOff: true }]);

    await installation().fleets.setFeatureFlag.mutate({ fleetId: fleet.fleetId, flag: 'sealing', isOn: true });
    expect((await installation().fleets.list.query()).find(({ fleetId }) => fleetId === fleet.fleetId)?.featureFlags).toEqual([{ flag: 'sealing', isOn: true, canTurnOff: true }]);
    expect(await flagEvents(fleet.fleetId)).toEqual([
      { type: 'FeatureFlagTurnedOn', actorKind: 'installation', details: { flag: 'sealing' } },
      { type: 'FeatureFlagTurnedOff', actorKind: 'installation', details: { flag: 'sealing' } },
      { type: 'FeatureFlagTurnedOn', actorKind: 'installation', details: { flag: 'sealing' } },
    ]);
  });

  it('refuses sealing off for a sealed fleet FEATURE_FLAG_IN_USE with its line, changing nothing, and answers it unable to go off', async () => {
    const fleet = await aFleet('northwind', ['sealing']);
    unwrap(await core.turnOnSealing(argoOf(fleet), { companyKey: await aKeyBoundTo(fleet.fleetId) }));
    const eventsBefore = await flagEvents(fleet.fleetId);

    const refusal = await refusalOfCall(installation().fleets.setFeatureFlag.mutate({ fleetId: fleet.fleetId, flag: 'sealing', isOn: false }));

    expect(refusal).toEqual({ code: 'CONFLICT', message: 'Sealed fleets keep sealing' });
    expect(await flagRows(fleet.fleetId)).toEqual(['sealing']);
    expect(await flagEvents(fleet.fleetId)).toEqual(eventsBefore);
    expect((await installation().fleets.get.query({ fleetId: fleet.fleetId })).featureFlags).toEqual([{ flag: 'sealing', isOn: true, canTurnOff: false }]);
  });

  it('refuses turning sealing on while the flag is off FEATURE_FLAG_OFF, and the fleet stays unsealed', async () => {
    const fleet = await aFleet('acme');

    const refusal = refusalOf(await core.turnOnSealing(argoOf(fleet), { companyKey: await aKeyBoundTo(fleet.fleetId) }));

    expect(refusal.kind).toBe('FEATURE_FLAG_OFF');
    await expect(database.fleet.findUnique({ where: { id: fleet.fleetId }, select: { sealingState: true } })).resolves.toEqual({ sealingState: null });
    await expect(database.dataKey.count({ where: { fleetId: fleet.fleetId } })).resolves.toBe(0);
  });

  it('answers console.session with the flags on for the session fleet', async () => {
    const offered = await aFleet('offered', ['sealing']);
    const notOffered = await aFleet('plain');
    const sessionOf = async (fleetId: FleetId) => {
      const { ticket } = await installation().operators.issueSignInTicket.mutate({ fleetId });
      const { token } = unwrap(await core.redeemSignInTicket({ ticket }));
      return client({ cookie: `${SESSION_COOKIE}=${token}` }).console.session.query();
    };

    await expect(sessionOf(offered.fleetId)).resolves.toMatchObject({ fleetId: offered.fleetId, featureFlags: ['sealing'] });
    await expect(sessionOf(notOffered.fleetId)).resolves.toMatchObject({ fleetId: notOffered.fleetId, featureFlags: [] });
  });

  it('never leaves a fleet sealed with its flag off when turning sealing on races turning the flag off', async () => {
    const fleets = await Promise.all(Array.from({ length: RACES }, (_unused, index) => aFleet(`race-${String(index)}`, ['sealing'])));
    const keys = await Promise.all(fleets.map(({ fleetId }) => aKeyBoundTo(fleetId)));

    await Promise.all(
      fleets.flatMap((fleet, index) => [
        core.turnOnSealing(argoOf(fleet), { companyKey: keys[index] ?? '' }),
        installation().fleets.setFeatureFlag.mutate({ fleetId: fleet.fleetId, flag: 'sealing', isOn: false }).catch(() => undefined),
      ]),
    );

    for (const fleet of fleets) {
      const isSealed = (await database.fleet.findUnique({ where: { id: fleet.fleetId }, select: { sealingState: true } }))?.sealingState !== null;
      const isFlagOff = (await flagRows(fleet.fleetId)).length === 0;
      expect({ fleetId: fleet.fleetId, isSealedWithFlagOff: isSealed && isFlagOff }).toEqual({ fleetId: fleet.fleetId, isSealedWithFlagOff: false });
    }
  });
});

describe('the feature flags migration on Postgres (decision 0069)', () => {
  it('gives a fleet that is sealing or sealed the sealing flag, and every other fleet none', async () => {
    const sealed = await aFleet('sealed-before', ['sealing']);
    unwrap(await core.turnOnSealing(argoOf(sealed), { companyKey: await aKeyBoundTo(sealed.fleetId) }));
    const plain = await aFleet('plain-before');
    // The table as the migration found it: no row for any fleet.
    await database.fleetFeatureFlag.deleteMany({ where: { fleetId: { in: [sealed.fleetId, plain.fleetId] } } });
    const migration = await readFile(new URL('../src/adapters/prisma/migrations/20261102090000_feature_flags/migration.sql', import.meta.url), 'utf8');
    const start = migration.slice(migration.indexOf('INSERT INTO "fleet_feature_flags"'));

    await database.$executeRawUnsafe(`${start.trim().replace(/;$/, '')} AND f."id" IN ('${sealed.fleetId}', '${plain.fleetId}')`);

    expect(await flagRows(sealed.fleetId)).toEqual(['sealing']);
    expect(await flagRows(plain.fleetId)).toEqual([]);
  });
});
