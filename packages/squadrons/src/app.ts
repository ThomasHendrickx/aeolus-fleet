import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { createFleetConsoleSessions } from './adapters/fleet/console-sessions.js';
import { watchManagementLease } from './adapters/fleet/lease-watching-door.js';
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
import { createConnect, type Connect } from './core/management/connect.js';
import { createReadConnection, type ReadConnection } from './core/management/read-connection.js';
import { createAuthenticateOperator } from './core/operator/authenticate-operator.js';
import { createFormSquadron, type FormSquadron } from './core/squadron/form-squadron.js';
import { createHandleFlagshipDelivery } from './core/squadron/handle-flagship-delivery.js';
import { createListSquadrons } from './core/squadron/list-squadrons.js';
import { createAdvanceStandDowns } from './core/squadron/advance-stand-downs.js';
import { createStandDown, type StandDown } from './core/squadron/stand-down.js';
import { createForceStandDown } from './core/squadron/force-stand-down.js';
import { createAddMember } from './core/squadron/add-member.js';
import { createRemoveMember } from './core/squadron/remove-member.js';
import { createRecoverFormations, type RecoverFormations } from './core/squadron/recover-formations.js';
import type { Clock } from './core/shared/clock.js';

export const systemClock: Clock = { now: () => new Date() };

export interface SquadronsApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation. */
  server: FastifyInstance;
  /** Whether squadrons is connected; a kept crew token the fleet no longer takes is dropped. Read at start. */
  readConnection: ReadConnection;
  /** Connects squadrons as the operator's management ship, then recovers formations and starts the flagships. */
  connect: Connect;
  /** Reads the repositories again; on failure the catalogue stays as it was and the failure is logged. */
  refreshCatalogue: () => Promise<void>;
  /** Refreshes the catalogue now and then every interval, until the app closes. */
  startRefreshing: (intervalMs: number) => Promise<void>;
  /** Retires what formations a crash left unfinished commissioned: run once connected, before anything else forms. */
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
  /** The repositories of templates and blueprints (docs/squadrons.md, "Configuration"). */
  repositories: readonly GitRepository[];
  /** Where the repositories' mirrors are kept. */
  cacheDir: string;
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
}): SquadronsApp {
  const prisma = createPrismaClient(options.databaseUrl);
  const server = Fastify({ logger: options.logger ?? true });
  const store = createPrismaManagementCrewStore(prisma);
  // From what squadrons holds, without asking the fleet: health and version stay quick.
  const connectionOf = async (): Promise<'connected' | 'not-connected'> => ((await store.find()) ? 'connected' : 'not-connected');

  // The version this process runs and its database's latest migration. No authentication, no fleet data.
  const version = runningVersion();
  server.get('/api/version', async () => {
    let migration: string | null = null;
    try {
      migration = await latestMigration(prisma);
    } catch (error) {
      server.log.error({ err: error }, 'latest migration unknown');
    }
    return { squadrons: version, migration, connection: await connectionOf() };
  });

  // Up and its database reachable.
  server.get('/api/health', async (_request, reply) => {
    try {
      await checkDatabase(prisma);
      return { status: 'ok', connection: await connectionOf() };
    } catch (error) {
      server.log.error({ err: error }, 'database unreachable');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  const clock = options.clock ?? systemClock;
  const squadrons = createPrismaSquadronRepository(prisma, clock);
  const attempts = createPrismaFormationAttempts(prisma, clock);
  const door = watchManagementLease(createRestFleetDoor(options.fleetUrl), store);
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

  const listSquadrons = createListSquadrons({ door, management: store, squadrons, clock });
  const advanceStandDowns = createAdvanceStandDowns({ door, management: store, squadrons, clock });
  const standDownOnly = createStandDown({ squadrons });
  const forceStandDown = createForceStandDown({ door, management: store, squadrons, clock });
  const removeMember = createRemoveMember({ door, management: store, squadrons, clock });
  const addMember = createAddMember({ door, management: store, squadrons, attempts, random: cryptoRandomNames, clock });
  // Each member gets its stand-down at once, not at the next rescan.
  const standDown: StandDown = async (input) => {
    const stood = await standDownOnly(input);
    if (stood.isOk) {
      await flagships?.rescan();
    }
    return stood;
  };
  const recoverFormations = createRecoverFormations({ door, management: store, attempts });
  const readConnection = createReadConnection({ door, store });
  const connectOnly = createConnect({ door, store, clock });
  // Once connected, what waited for it: formations a crash left unfinished, then the flagships.
  const connect: Connect = async (input) => {
    const connected = await connectOnly(input);
    if (connected.isOk) {
      const recovered = await recoverFormations();
      if (!recovered.isOk) {
        server.log.error({ refusal: recovered.error }, 'formations a crash left unfinished could not be recovered');
      }
      await flagships?.rescan();
    }
    return connected;
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
        isConnected: async () => (await connectionOf()) === 'connected',
        readConnection,
        connect,
        catalogue: () => catalogue,
        refreshCatalogue,
        formSquadron: formAndWatch,
        listSquadrons,
        standDown,
        forceStandDown,
        addMember,
        removeMember,
        keptMessages: (fleetId, squadronId) => keptMessages.list(fleetId, squadronId),
      }),
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  let refresher: ReturnType<typeof setInterval> | undefined;
  server.addHook('onClose', async () => {
    clearInterval(refresher);
    await flagships?.stop();
    await prisma.$disconnect();
  });

  return {
    server,
    readConnection,
    connect,
    refreshCatalogue,
    startRefreshing: async (intervalMs) => {
      await refreshCatalogue();
      refresher = setInterval(() => void refreshCatalogue(), intervalMs);
    },
    recoverFormations,
    startFlagships: (rescanMs) => {
      flagships = watchFlagships({
        door,
        management: store,
        squadrons,
        handle: createHandleFlagshipDelivery({ door, squadrons, messages: keptMessages, operator, advanceStandDowns, clock }),
        advanceStandDowns,
        operator,
        log: server.log,
        rescanMs,
      });
      void flagships.rescan();
    },
    close: () => server.close(),
  };
}
