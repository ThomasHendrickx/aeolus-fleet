import type { FleetId } from '@aeolus-fleet/common';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { sha256RequestHasher } from './adapters/crypto/request-hasher.js';
import { createFleetConsoleSessions } from './adapters/fleet/console-sessions.js';
import { watchFleets, type FleetWatch } from './adapters/fleet/fleet-watch.js';
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
import { createReceiveOnce } from './core/inbox/receive-once.js';
import { createFollowDeclarations } from './core/network/follow-declarations.js';
import { createReadNetwork } from './core/network/read-network.js';
import { createSaveDeclaration } from './core/network/save-declaration.js';
import { createSaveRules } from './core/network/save-rules.js';
import { createSupplies, type SupplyState } from './core/network/supplies.js';
import { createSupplyFleet } from './core/network/supply-fleet.js';
import { createAuthenticateOperator } from './core/operator/authenticate-operator.js';
import type { Clock } from './core/shared/clock.js';

export const systemClock: Clock = { now: () => new Date() };

export interface NetworkingPluginApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation. */
  server: FastifyInstance;
  /**
   * At start: reads every served fleet's kept connection, dropping a crew
   * token its fleet no longer takes, then supplies every fleet it is
   * connected to anew, on reconnect (Thomas on #260): registers and supplies
   * its rules where it is on, unregisters where it is off. Answers each fleet
   * still connected, as which ship, and what its supply did.
   */
  restoreConnections: () => Promise<{ fleetId: FleetId; ship: string; supply: SupplyState }[]>;
  /** Supplies again, every interval, each fleet whose last supply the fleet refused, until the app closes. */
  startSupplying: (intervalMs: number) => void;
  /** Receives in every fleet it is connected to and serves, acknowledging each delivery, until the app closes; rescans every interval. */
  startReceiving: (rescanMs?: number) => void;
  /** Follows every fleet it is connected to and serves, supplying it again when a ship declares its rules (decision 0037), until the app closes; rescans every interval. */
  startFollowing: (rescanMs?: number) => void;
  /** Stops the server and disconnects the database. */
  close(): Promise<void>;
}

/** How often the receiving looks for a fleet newly connected or switched on, unless given. */
const DEFAULT_RESCAN_MS = 5_000;

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
  const readNetwork = createReadNetwork({ networks });
  const saveRules = createSaveRules({ networks, supplies });
  const saveDeclaration = createSaveDeclaration({ networks, supplies });
  const receiveOnce = createReceiveOnce({ door, connections });
  const followDeclarations = createFollowDeclarations({ door, connections, supplies });
  let supplying: NodeJS.Timeout | undefined;
  let receiving: FleetWatch | undefined;
  let following: FleetWatch | undefined;

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
        isConnected: async (fleetId: FleetId) => (await connections.find(fleetId)) !== undefined,
        isServed,
        heldConnection,
        installationTokenSent: typeof req.headers['x-aeolus-installation-token'] === 'string' ? req.headers['x-aeolus-installation-token'] : undefined,
        installation: { mode: installation, token: options.installationToken },
        setFleetEnabled,
        readFleet,
        deleteFleet,
        readConnection,
        connect,
        readNetwork,
        saveRules,
        saveDeclaration,
      }),
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  server.addHook('onClose', async () => {
    clearInterval(supplying);
    await receiving?.stop();
    await following?.stop();
    await prisma.$disconnect();
  });

  return {
    server,
    restoreConnections: async () => {
      const restored: { fleetId: FleetId; ship: string; supply: SupplyState }[] = [];
      for (const crew of await connections.connected()) {
        // A fleet that is off is not read; its supply unregisters there, as switching it off does.
        const connection = (await isServed(crew.fleetId)) ? await readConnection(crew.fleetId) : await heldConnection(crew.fleetId);
        if (connection.state === 'connected') {
          restored.push({ fleetId: crew.fleetId, ship: connection.ship?.name ?? crew.name, supply: await supplies.supply(crew.fleetId) });
        }
      }
      return restored;
    },
    startSupplying: (intervalMs) => {
      // One retry at a time: a retry that outlasts the interval makes the next one wait.
      let isRetrying = false;
      supplying = setInterval(() => {
        if (isRetrying) {
          return;
        }
        isRetrying = true;
        supplies
          .retry()
          .then((tried) => {
            for (const { fleetId, state } of tried) {
              server.log.info({ fleet: fleetId, supply: state }, 'supplied again');
            }
          })
          .catch((error: unknown) => {
            server.log.error({ err: error }, 'supplying again failed; the next retry tries again');
          })
          .finally(() => {
            isRetrying = false;
          });
      }, intervalMs);
    },
    startReceiving: (rescanMs = DEFAULT_RESCAN_MS) => {
      receiving = watchFleets({ once: receiveOnce, doing: 'receiving', connections, isServed, log: server.log, rescanMs });
      void receiving.rescan();
    },
    startFollowing: (rescanMs = DEFAULT_RESCAN_MS) => {
      following = watchFleets({ once: followDeclarations, doing: 'following', connections, isServed, log: server.log, rescanMs });
      void following.rescan();
    },
    close: () => server.close(),
  };
}
