import { mcpUrlOf, type FleetId } from '@aeolus-fleet/common';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { createFleetConsoleSessions } from './adapters/fleet/console-sessions.js';
import { watchManagementLease } from './adapters/fleet/lease-watching-door.js';
import { createRestFleetDoor } from './adapters/fleet/rest-fleet-door.js';
import { sha256RequestHasher } from './adapters/crypto/request-hasher.js';
import { createGithubRepositoryReader } from './adapters/github/github-repository-reader.js';
import { createPrismaFleetForgetter } from './adapters/prisma/fleet-forgetter.js';
import { createPrismaFleetSwitches } from './adapters/prisma/fleet-switches.js';
import { createPrismaInstallationRequests } from './adapters/prisma/installation-requests.js';
import { createPrismaRepositoryStore } from './adapters/prisma/repository-store.js';
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
import { createAddRepository } from './core/catalogue/add-repository.js';
import { createListRepositories } from './core/catalogue/list-repositories.js';
import { createRefreshCatalogue, type RefreshScope } from './core/catalogue/refresh-catalogue.js';
import { createRemoveRepository } from './core/catalogue/remove-repository.js';
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
import { createDeleteFleet } from './core/installation/delete-fleet.js';
import type { FleetForgetter, InstallationMode } from './core/installation/ports.js';
import { createReadFleet } from './core/installation/read-fleet.js';
import { createIsServed } from './core/installation/served.js';
import { createSetFleetEnabled } from './core/installation/set-fleet-enabled.js';
import { createNewCrewLine } from './core/squadron/new-crew-line.js';
import { createRecoverFormations, type RecoverFormations } from './core/squadron/recover-formations.js';
import type { Clock } from './core/shared/clock.js';

export const systemClock: Clock = { now: () => new Date() };

export interface SquadronsApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation. */
  server: FastifyInstance;
  /** Whether squadrons is connected to a fleet; a kept crew token the fleet no longer takes is dropped. */
  readConnection: ReadConnection;
  /** Connects squadrons to the operator's fleet as its management ship, then recovers that fleet's formations, fetches its catalogue and starts its flagships. */
  connect: Connect;
  /** Fetches every template repository of every connected fleet and rebuilds each fleet's catalogue, at start; a failure is logged. */
  refreshCatalogue: () => Promise<void>;
  /** Retires what formations of a fleet a crash left unfinished commissioned: run once connected, before anything else forms. */
  recoverFormations: RecoverFormations;
  /**
   * At start: reads every fleet's kept connection (dropping a crew token its
   * fleet no longer takes) and recovers each connected fleet's formations;
   * answers each fleet still connected, as which ship, and what it recovered.
   */
  restoreConnections: () => Promise<{ fleetId: FleetId; ship: string; recovered: number; retired: number }[]>;
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
  /** GitHub's REST API, where the template repositories are read; api.github.com unless a test gives a fake. */
  githubApiUrl?: string;
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
  /** The installation token (decision 0021): unset, the installation is open and every fleet is served. */
  installationToken?: string;
}): SquadronsApp {
  const prisma = createPrismaClient(options.databaseUrl);
  const server = Fastify({ logger: options.logger ?? true });
  const store = createPrismaManagementCrewStore(prisma);
  const installation: InstallationMode = options.installationToken === undefined ? 'open' : 'enabled';
  const switches = createPrismaFleetSwitches(prisma);
  const isServed = createIsServed({ installation, switches });
  // From what squadrons holds, without asking any fleet: health and version stay quick.
  const connectedFleets = async (): Promise<number> => (await store.connected()).length;

  // The version this process runs and its database's latest migration. No authentication, no fleet data.
  const version = runningVersion();
  server.get('/api/version', async () => {
    let migration: string | null = null;
    try {
      migration = await latestMigration(prisma);
    } catch (error) {
      server.log.error({ err: error }, 'latest migration unknown');
    }
    return { squadrons: version, migration, connectedFleets: await connectedFleets(), installation };
  });

  // Up and its database reachable.
  server.get('/api/health', async (_request, reply) => {
    try {
      await checkDatabase(prisma);
      return { status: 'ok', connectedFleets: await connectedFleets(), installation };
    } catch (error) {
      server.log.error({ err: error }, 'database unreachable');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  const clock = options.clock ?? systemClock;
  const squadrons = createPrismaSquadronRepository(prisma, clock);
  const attempts = createPrismaFormationAttempts(prisma, clock);
  const door = watchManagementLease(createRestFleetDoor(options.fleetUrl), store);
  const mcpUrl = mcpUrlOf(options.fleetUrl);
  const keptMessages = createPrismaFlagshipMessageLog(prisma);
  const operator = createOperatorNotices({ door, management: store });
  let flagships: FlagshipWatch | undefined;
  // One catalogue per fleet: a refresh for a fleet squadrons served earlier never reaches the one it serves now.
  const catalogues = new Map<FleetId, Catalogue>();
  const catalogueOf = (fleetId: FleetId): Catalogue => catalogues.get(fleetId) ?? { templates: [], blueprints: [], problems: [] };
  const formSquadron = createFormSquadron({ door, management: store, squadrons, attempts, catalogue: catalogueOf, random: cryptoRandomNames, clock, mcpUrl });
  // A new squadron's flagship starts receiving at once, not at the next rescan.
  const formAndWatch: FormSquadron = async (input) => {
    const formed = await formSquadron(input);
    if (formed.isOk) {
      await flagships?.rescan();
    }
    return formed;
  };
  const repositories = createPrismaRepositoryStore(prisma);
  const source = createGithubRepositoryReader(options.githubApiUrl === undefined ? {} : { apiUrl: options.githubApiUrl });
  const refresh = createRefreshCatalogue({
    store: repositories,
    source,
    holder: {
      get: catalogueOf,
      set: (fleetId, built) => {
        catalogues.set(fleetId, built);
      },
    },
    clock,
  });
  // Each connected fleet's catalogue, fetched; one fleet's failure leaves the others' as they are.
  const refreshFleet = async (fleetId: FleetId, scope: RefreshScope): Promise<void> => {
    try {
      await refresh(fleetId, scope);
    } catch (error) {
      server.log.error({ err: error, fleet: fleetId }, "the fleet's template repositories could not be read; its catalogue stays as it was");
    }
  };
  const listRepositories = createListRepositories({ store: repositories });
  const addRepository = createAddRepository({ store: repositories, refresh, clock });
  const removeRepository = createRemoveRepository({ store: repositories, source, refresh });

  const listSquadrons = createListSquadrons({ door, management: store, squadrons, clock });
  const advanceStandDowns = createAdvanceStandDowns({ door, management: store, squadrons, clock });
  const standDownOnly = createStandDown({ squadrons });
  const forceStandDown = createForceStandDown({ door, management: store, squadrons, clock });
  const removeMember = createRemoveMember({ door, management: store, squadrons, clock });
  const newCrewLine = createNewCrewLine({ door, management: store, squadrons, mcpUrl });
  const addMember = createAddMember({ door, management: store, squadrons, attempts, random: cryptoRandomNames, clock, mcpUrl });
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
  // A fleet's connection as squadrons holds it, asking the fleet nothing: what a fleet that is off reads.
  const heldConnection: ReadConnection = async (fleetId) => {
    const crew = await store.find(fleetId);
    if (crew) {
      return { state: 'connected', ship: { shipId: crew.shipId, name: crew.name }, lastShipId: crew.shipId };
    }
    return { state: 'not-connected', ship: null, lastShipId: (await store.binding(fleetId))?.shipId ?? null };
  };
  const requests = createPrismaInstallationRequests(prisma);
  const forgetFleet = createPrismaFleetForgetter(prisma);
  // Forgetting a fleet also drops what this process holds of it: each repository's last read, and its catalogue.
  const forgetter: FleetForgetter = {
    forget: async (fleetId) => {
      for (const repository of await repositories.list(fleetId)) {
        await source.forget(repository);
      }
      await forgetFleet.forget(fleetId);
      catalogues.delete(fleetId);
    },
  };
  const setFleetEnabled = createSetFleetEnabled({ switches, requests, hasher: sha256RequestHasher, clock });
  const readFleet = createReadFleet({ isServed, management: store });
  const deleteFleet = createDeleteFleet({ forgetter, requests, hasher: sha256RequestHasher, clock });
  const connectOnly = createConnect({ door, store, clock });
  // Once connected, what waited for it: formations a crash left unfinished, the catalogue (every repository fetched once), then the flagships.
  const connect: Connect = async (input) => {
    const connected = await connectOnly(input);
    if (connected.isOk) {
      const recovered = await recoverFormations(input.operatorFleetId);
      if (!recovered.isOk) {
        server.log.error({ refusal: recovered.error, fleet: input.operatorFleetId }, 'formations a crash left unfinished could not be recovered');
      }
      await refreshFleet(input.operatorFleetId, 'all');
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
        authenticateOperator: createAuthenticateOperator({ sessions: createFleetConsoleSessions(options.fleetUrl) }),
        isConnected: async (fleetId) => (await store.find(fleetId)) !== undefined,
        isServed,
        heldConnection,
        installationTokenSent: typeof req.headers['x-aeolus-installation-token'] === 'string' ? req.headers['x-aeolus-installation-token'] : undefined,
        installation: { mode: installation, token: options.installationToken },
        setFleetEnabled,
        readFleet,
        deleteFleet,
        readConnection,
        connect,
        catalogue: catalogueOf,
        refreshCatalogue: (fleetId) => refresh(fleetId, 'all'),
        listRepositories,
        addRepository,
        removeRepository,
        formSquadron: formAndWatch,
        listSquadrons,
        standDown,
        forceStandDown,
        addMember,
        removeMember,
        newCrewLine,
        keptMessages: (fleetId, squadronId) => keptMessages.list(fleetId, squadronId),
      }),
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  server.addHook('onClose', async () => {
    await flagships?.stop();
    await prisma.$disconnect();
  });

  return {
    server,
    readConnection,
    connect,
    refreshCatalogue: async () => {
      for (const crew of await store.connected()) {
        if (await isServed(crew.fleetId)) {
          await refreshFleet(crew.fleetId, 'all');
        }
      }
    },
    recoverFormations,
    restoreConnections: async () => {
      const restored: { fleetId: FleetId; ship: string; recovered: number; retired: number }[] = [];
      for (const crew of await store.connected()) {
        // A fleet that is off rests: its connection waits, unread, for it to be on again.
        if (!(await isServed(crew.fleetId))) {
          continue;
        }
        const connection = await readConnection(crew.fleetId);
        if (connection.state !== 'connected') {
          continue;
        }
        const recovered = await recoverFormations(crew.fleetId);
        if (!recovered.isOk) {
          server.log.error({ refusal: recovered.error, fleet: crew.fleetId }, 'formations a crash left unfinished could not be recovered');
        }
        restored.push({ fleetId: crew.fleetId, ship: connection.ship?.name ?? crew.name, ...(recovered.isOk ? recovered.value : { recovered: 0, retired: 0 }) });
      }
      return restored;
    },
    startFlagships: (rescanMs) => {
      flagships = watchFlagships({
        door,
        management: store,
        squadrons,
        handle: createHandleFlagshipDelivery({ door, squadrons, messages: keptMessages, operator, advanceStandDowns, clock }),
        advanceStandDowns,
        isServed,
        operator,
        log: server.log,
        rescanMs,
      });
      void flagships.rescan();
    },
    close: () => server.close(),
  };
}
