import { NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS, NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS, type NetworkRule } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeSqlFile } from '@aeolus-fleet/core/testing';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetNetworks } from '../src/adapters/prisma/fleet-networks.js';
import { createPluginDatabase } from './support/database.js';

// The database keeps a fleet's declaration within common's bounds, whoever writes it (#758).

let databaseUrl: string;
let db: PrismaClient;

beforeEach(async () => {
  databaseUrl = await createPluginDatabase();
  db = createPrismaClient(databaseUrl);
});

afterEach(async () => {
  await db.$disconnect();
});

/** Saves a fleet's network with the not responding time given, each under a fleet of its own. */
const saved = async (notRespondingAfterSeconds: number) =>
  createPrismaFleetNetworks(db).save(`flt_${String(notRespondingAfterSeconds)}`, { rules: null, declaration: { whileUnavailable: 'block-all', notRespondingAfterSeconds } });

describe("a fleet's declaration in the database", () => {
  it('keeps a not responding time from the least to the most', async () => {
    await saved(NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS);
    await saved(NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS);

    await expect(db.fleetNetwork.count()).resolves.toBe(2);
  });

  it('refuses a not responding time below the least', async () => {
    await expect(saved(NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS - 1)).rejects.toThrow(/fleet_networks_not_responding_after_bounded/);
  });

  it('refuses a not responding time above the most', async () => {
    await expect(saved(NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS + 1)).rejects.toThrow(/fleet_networks_not_responding_after_bounded/);
  });
});

describe("a fleet's rules in the database", () => {
  const declaration = { whileUnavailable: 'block-all', notRespondingAfterSeconds: 120 } as const;

  it('keeps each rule with its verb', async () => {
    const rules: NetworkRule[] = [
      { verb: 'send', from: ['lbv_01m4jtkdcqe51e0v00c76eec2d'], to: [] },
      { verb: 'read', from: [], to: [] },
    ];
    await createPrismaFleetNetworks(db).save('flt_01m4jtkdcqe51e0v00c76eec2e', { rules, declaration });

    await expect(createPrismaFleetNetworks(db).find('flt_01m4jtkdcqe51e0v00c76eec2e')).resolves.toEqual({ rules, declaration });
  });

  it('makes every rule saved before verbs a send rule, as rules allowed only sends then, and keeps none as none', async () => {
    const MIGRATIONS = fileURLToPath(new URL('../src/adapters/prisma/migrations', import.meta.url));
    const networkVerbs = readdirSync(MIGRATIONS).find((name) => name.endsWith('_network_verbs'));
    const rule = { from: ['lbv_01m4jtkdcqe51e0v00c76eec2d'], to: [] };
    await db.fleetNetwork.createMany({
      data: [
        { fleetId: 'flt_01m4jtkdcqe51e0v00c76eec2e', rules: [rule], ...declaration },
        { fleetId: 'flt_01m4jtkdcqe51e0v00c76eec2f', ...declaration },
      ],
    });

    await executeSqlFile(databaseUrl, `${MIGRATIONS}/${networkVerbs ?? 'missing'}/migration.sql`);

    await expect(db.fleetNetwork.findMany({ select: { rules: true }, orderBy: { fleetId: 'asc' } })).resolves.toEqual([{ rules: [{ verb: 'send', ...rule }] }, { rules: null }]);
  });
});
