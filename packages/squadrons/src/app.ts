import type { ShipId } from '@aeolus-fleet/common';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { createFleetConsoleSessions } from './adapters/fleet/console-sessions.js';
import { createRestFleetDoor } from './adapters/fleet/rest-fleet-door.js';
import { createGitCatalogueSource, type GitRepository } from './adapters/git/git-catalogue-source.js';
import { runningVersion } from './adapters/http/version.js';
import { checkDatabase, createPrismaClient, latestMigration } from './adapters/prisma/client.js';
import { createPrismaManagementCrewStore } from './adapters/prisma/management-crew-store.js';
import { createPrismaSquadronRepository } from './adapters/prisma/squadron-repository.js';
import { createPrismaFlagshipMessageLog } from './adapters/prisma/flagship-message-log.js';
import { createPrismaFormationAttempts } from './adapters/prisma/formation-attempts.js';
import { createOperatorNotices } from './adapters/fleet/operator-notices.js';
import { cryptoRandomNames } from './adapters/crypto/random-names.js';
import { watchFlagships, type FlagshipWatch } from './adapters/flagships/flagship-watch.js';
import { squadronsRouter, type SquadronsRouter } from './adapters/trpc/router.js';
import { assembleCatalogue } from './core/catalogue/assemble-catalogue.js';
import type { Catalogue } from './core/catalogue/catalogue.js';
import { createCrewManagementShip, type CrewManagementShip } from './core/management/crew-management-ship.js';
import { createAuthenticateOperator } from './core/operator/authenticate-operator.js';
import { createFormSquadron, type FormSquadron } from './core/squadron/form-squadron.js';
import { createHandleFlagshipDelivery } from './core/squadron/handle-flagship-delivery.js';
import { createRecoverFormations, type RecoverFormations } from './core/squadron/recover-formations.js';
import type { Clock } from './core/shared/clock.js';

export const systemClock: Clock = { now: () => new Date() };

export interface SquadronsApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation. */
  server: FastifyInstance;
  /** Crews the management ship, from the kept crew token or with the secret. */
  crewManagementShip: CrewManagementShip;
  /** Reads the repositories again; on failure the catalogue stays as it was and the failure is logged. */
  refreshCatalogue: () => Promise<void>;
  /** Refreshes the catalogue now and then every interval, until the app closes. */
  startRefreshing: (intervalMs: number) => Promise<void>;
  /** Retires what formations a crash left unfinished commissioned: run at start, before anything else forms. */
  recoverFormations: RecoverFormations;
  /** Starts receiving on every forming or sailing squadron's flagship, looking for new squadrons every interval. */
  startFlagships: (rescanMs: number) => void;
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
  /** The repositories of templates and blueprints (docs/squadrons.md, "Configuration"). */
  repositories: readonly GitRepository[];
  /** Where the repositories' mirrors are kept. */
  cacheDir: string;
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

  const store = createPrismaManagementCrewStore(prisma);
  const clock = options.clock ?? systemClock;
  const squadrons = createPrismaSquadronRepository(prisma, clock);
  const attempts = createPrismaFormationAttempts(prisma, clock);
  const door = createRestFleetDoor(options.fleetUrl);
  const keptMessages = createPrismaFlagshipMessageLog(prisma);
  const operator = createOperatorNotices({ door, management: store });
  let flagships: FlagshipWatch | undefined;
  const formSquadron = createFormSquadron({ door, management: store, squadrons, attempts, catalogue: () => catalogue, random: cryptoRandomNames, clock });
  // A new squadron's flagship starts receiving at once, not at the next rescan.
  const formAndWatch: FormSquadron = async (input) => {
    const formed = await formSquadron(input);
    if (formed.isOk) {
      await flagships?.rescan();
    }
    return formed;
  };
  const source = createGitCatalogueSource({ repositories: options.repositories, cacheDir: options.cacheDir });
  let catalogue: Catalogue = { templates: [], blueprints: [], problems: [] };
  const refreshCatalogue = async (): Promise<void> => {
    try {
      catalogue = assembleCatalogue(await source.files());
    } catch (error) {
      server.log.error({ err: error }, 'the repositories could not be read; the catalogue stays as it was');
    }
  };

  const trpc: FastifyTRPCPluginOptions<SquadronsRouter> = {
    prefix: '/trpc',
    trpcOptions: {
      router: squadronsRouter,
      onError: ({ error, path }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          server.log.error({ err: error.cause ?? error, path }, 'procedure failed');
        }
      },
      createContext: ({ req }) => ({
        cookie: req.headers.cookie,
        authenticateOperator: createAuthenticateOperator({ sessions: createFleetConsoleSessions(options.fleetUrl), store }),
        catalogue: () => catalogue,
        refreshCatalogue,
        formSquadron: formAndWatch,
        listSquadrons: (fleetId) => squadrons.list(fleetId),
        keptMessages: (fleetId, squadronId) => keptMessages.list(fleetId, squadronId),
      }),
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  let refresher: ReturnType<typeof setInterval> | undefined;
  server.addHook('onClose', async () => {
    clearInterval(refresher);
    flagships?.stop();
    await prisma.$disconnect();
  });

  return {
    server,
    crewManagementShip: createCrewManagementShip({ door, store, clock, ship: options.managementShip }),
    refreshCatalogue,
    startRefreshing: async (intervalMs) => {
      await refreshCatalogue();
      refresher = setInterval(() => void refreshCatalogue(), intervalMs);
    },
    recoverFormations: createRecoverFormations({ door, management: store, attempts }),
    startFlagships: (rescanMs) => {
      flagships = watchFlagships({
        door,
        management: store,
        squadrons,
        handle: createHandleFlagshipDelivery({ door, squadrons, messages: keptMessages, operator, clock }),
        operator,
        log: server.log,
        rescanMs,
      });
      void flagships.rescan();
    },
    close: () => server.close(),
  };
}
