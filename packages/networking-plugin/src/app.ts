import type { FleetId } from '@aeolus-fleet/common';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { sha256RequestHasher } from './adapters/crypto/request-hasher.js';
import { createFleetConsoleSessions } from './adapters/fleet/console-sessions.js';
import { createRestFleetDoor } from './adapters/fleet/rest-fleet-door.js';
import { runningVersion } from './adapters/http/version.js';
import { checkDatabase, createPrismaClient } from './adapters/prisma/client.js';
import { createPrismaConnectionStore } from './adapters/prisma/connection-store.js';
import { createPrismaFleetForgetter } from './adapters/prisma/fleet-forgetter.js';
import { createPrismaFleetNetworks } from './adapters/prisma/fleet-networks.js';
import { createPrismaFleetSwitches } from './adapters/prisma/fleet-switches.js';
import { createPrismaInstallationRequests } from './adapters/prisma/installation-requests.js';
import { networkingPluginRouter, type NetworkingPluginRouter } from './adapters/trpc/router.js';
import { createConnect } from './core/connection/connect.js';
import { createReadConnection, type ReadConnection } from './core/connection/read-connection.js';
import { createDeleteFleet } from './core/installation/delete-fleet.js';
import type { InstallationMode } from './core/installation/ports.js';
import { createReadFleet } from './core/installation/read-fleet.js';
import { createIsServed } from './core/installation/served.js';
import { createSetFleetEnabled } from './core/installation/set-fleet-enabled.js';
import { createSupplies } from './core/network/supplies.js';
import { createSupplyFleet } from './core/network/supply-fleet.js';
import { createAuthenticateOperator } from './core/operator/authenticate-operator.js';
import type { Clock } from './core/shared/clock.js';

export const systemClock: Clock = { now: () => new Date() };

export interface NetworkingPluginApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation. */
  server: FastifyInstance;
  /**
   * At start: reads every served fleet's kept connection, dropping a crew
   * token its fleet no longer takes; answers each fleet still connected, as
   * which ship.
   */
  restoreConnections: () => Promise<{ fleetId: FleetId; ship: string }[]>;
  /** Stops the server and disconnects the database. */
  close(): Promise<void>;
}

/**
 * The networking plugin wired to its own database and to the fleet's public
 * API. A pure API: the console's server calls it, with the console's session
 * cookie; it needs no public address of its own.
 */
export function createNetworkingPluginApp(options: {
  databaseUrl: string;
  fleetUrl: string;
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
  /** The installation token (decision 0021): unset, the installation is open and every fleet is served. */
  installationToken?: string;
}): NetworkingPluginApp {
  const prisma = createPrismaClient(options.databaseUrl);
  const server = Fastify({ logger: options.logger ?? true });
  const connections = createPrismaConnectionStore(prisma);
  const installation: InstallationMode = options.installationToken === undefined ? 'open' : 'enabled';
  const switches = createPrismaFleetSwitches(prisma);
  const isServed = createIsServed({ installation, switches });
  // Only the version this process runs: no authentication, so nothing about
  // its database, its migrations, its installation or fleets.
  const version = runningVersion();
  server.get('/api/version', () => ({ networkingPlugin: version }));

  // Up and its database reachable; nothing about its installation or fleets.
  server.get('/api/health', async (_request, reply) => {
    try {
      await checkDatabase(prisma);
      return { status: 'ok' };
    } catch (error) {
      server.log.error({ err: error }, 'database unreachable');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  const clock = options.clock ?? systemClock;
  const door = createRestFleetDoor(options.fleetUrl);
  const readConnection = createReadConnection({ door, store: connections });
  // A fleet's connection as the networking plugin holds it, asking the fleet nothing: what a fleet that is off reads.
  const heldConnection: ReadConnection = async (fleetId) => {
    const crew = await connections.find(fleetId);
    if (crew) {
      return { state: 'connected', ship: { shipId: crew.shipId, name: crew.name }, lastShipId: crew.shipId };
    }
    return { state: 'not-connected', ship: null, lastShipId: (await connections.binding(fleetId))?.shipId ?? null };
  };
  const networks = createPrismaFleetNetworks(prisma);
  const supplies = createSupplies({ supplyFleet: createSupplyFleet({ door, connections, networks, isServed }) });
  const requests = createPrismaInstallationRequests(prisma);
  const setFleetEnabled = createSetFleetEnabled({ switches, requests, hasher: sha256RequestHasher, clock, supplies });
  const readFleet = createReadFleet({ isServed, connections });
  const deleteFleet = createDeleteFleet({ forgetter: createPrismaFleetForgetter(prisma), requests, hasher: sha256RequestHasher, clock, door, connections });
  const connect = createConnect({ door, store: connections, clock, supplies });

  const trpc: FastifyTRPCPluginOptions<NetworkingPluginRouter> = {
    prefix: '/trpc',
    trpcOptions: {
      router: networkingPluginRouter,
      onError: ({ error, path }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          server.log.error({ err: error.cause ?? error, path }, 'procedure failed');
        }
      },
      createContext: ({ req }) => ({
        cookie: req.headers.cookie,
        authenticateOperator: createAuthenticateOperator({ sessions: createFleetConsoleSessions(options.fleetUrl) }),
        isServed,
        heldConnection,
        installationTokenSent: typeof req.headers['x-aeolus-installation-token'] === 'string' ? req.headers['x-aeolus-installation-token'] : undefined,
        installation: { mode: installation, token: options.installationToken },
        setFleetEnabled,
        readFleet,
        deleteFleet,
        readConnection,
        connect,
      }),
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  server.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return {
    server,
    restoreConnections: async () => {
      const restored: { fleetId: FleetId; ship: string }[] = [];
      for (const crew of await connections.connected()) {
        // A fleet that is off rests: its connection waits, unread, for it to be on again.
        if (!(await isServed(crew.fleetId))) {
          continue;
        }
        const connection = await readConnection(crew.fleetId);
        if (connection.state === 'connected') {
          restored.push({ fleetId: crew.fleetId, ship: connection.ship?.name ?? crew.name });
        }
      }
      return restored;
    },
    close: () => server.close(),
  };
}
