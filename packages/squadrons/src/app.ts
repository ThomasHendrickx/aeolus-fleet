import type { ShipId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { createRestFleetDoor } from './adapters/fleet/rest-fleet-door.js';
import { runningVersion } from './adapters/http/version.js';
import { checkDatabase, createPrismaClient, latestMigration } from './adapters/prisma/client.js';
import { createPrismaManagementCrewStore } from './adapters/prisma/management-crew-store.js';
import { createCrewManagementShip, type CrewManagementShip } from './core/management/crew-management-ship.js';
import type { Clock } from './core/shared/clock.js';

export const systemClock: Clock = { now: () => new Date() };

export interface SquadronsApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation. */
  server: FastifyInstance;
  /** Crews the management ship, from the kept crew token or with the secret. */
  crewManagementShip: CrewManagementShip;
  /** Stops the server and disconnects the database. */
  close(): Promise<void>;
}

/**
 * squadrons wired to its own database and to the fleet's public API. A pure
 * API: the web app's server calls it, with the console's session cookie, once
 * its pages arrive; it needs no public address of its own.
 */
export function createSquadronsApp(options: {
  databaseUrl: string;
  fleetUrl: string;
  managementShip: { shipId: ShipId; secret: string | undefined };
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
}): SquadronsApp {
  const prisma = createPrismaClient(options.databaseUrl);
  const server = Fastify({ logger: options.logger ?? true });

  // The version this process runs and its database's latest migration. No authentication, no fleet data.
  const version = runningVersion();
  server.get('/api/version', async () => {
    let migration: string | null = null;
    try {
      migration = await latestMigration(prisma);
    } catch (error) {
      server.log.error({ err: error }, 'latest migration unknown');
    }
    return { squadrons: version, migration };
  });

  // Up and its database reachable.
  server.get('/api/health', async (_request, reply) => {
    try {
      await checkDatabase(prisma);
      return { status: 'ok' };
    } catch (error) {
      server.log.error({ err: error }, 'database unreachable');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  server.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return {
    server,
    crewManagementShip: createCrewManagementShip({
      door: createRestFleetDoor(options.fleetUrl),
      store: createPrismaManagementCrewStore(prisma),
      clock: options.clock ?? systemClock,
      ship: options.managementShip,
    }),
    close: () => server.close(),
  };
}
