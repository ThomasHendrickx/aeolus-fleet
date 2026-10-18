import { NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MAX_SECONDS, NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetNetworks } from '../src/adapters/prisma/fleet-networks.js';
import { createPluginDatabase } from './support/database.js';

// The database keeps a fleet's declaration within common's bounds, whoever writes it (#758).

let db: PrismaClient;

beforeEach(async () => {
  db = createPrismaClient(await createPluginDatabase());
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
