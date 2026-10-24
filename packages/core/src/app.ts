import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import type { RateLimit } from './adapters/http/rate-limiter.js';
import { buildHttpServer } from './adapters/http/server.js';
import { createAccountTokenSignatures } from './adapters/crypto/account-token-signatures.js';
import { checkDatabase, createPrismaClient, latestMigration } from './adapters/prisma/client.js';
import { listenForPendingDeliveries } from './adapters/prisma/delivery-notices.js';
import { failureForLog } from './adapters/prisma/failure-log.js';
import { createFleetEventWakeups, fleetEventWakeupsOf } from './adapters/prisma/fleet-event-wakeups.js';
import { createReceiverWakeups } from './adapters/prisma/receiver-wakeups.js';
import type { Clock } from './domain/shared/clock.js';
import { repeatPass } from './repeating-pass.js';
import { createUseCases, systemClock } from './wiring.js';

export interface AppOptions {
  databaseUrl: string;
  /** Where ships reach the fleet: every starting prompt carries the fleet MCP URL under it. */
  publicUrl: string;
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
  shouldTrustProxy?: boolean;
  signInRateLimit?: RateLimit;
  registerRateLimit?: RateLimit;
  /** The domain the session cookie is set for. Unset: the server's host only. */
  cookieDomain?: string;
  /**
   * The console's origin: state-changing console calls come only from it.
   * Unset: the public URL's origin, for web and server behind one host.
   */
  consoleOrigin?: string;
  /** How long a receive waits on an empty inbox; about 25 seconds unless a test says otherwise. */
  receiveWaitMs?: number;
  /** The installation token that opens the installation procedures; unset, they are off. */
  installationToken?: string;
  /** How often the 10 and 60 minute clocks pass; every 30 seconds unless a test says otherwise. */
  overduePassMs?: number;
  /** pagasae's URL, the issuer whose account tokens core trusts (decision 0058); unset, it trusts none. */
  accountTokenIssuer?: string;
}

/** How often core runs the 10 and 60 minute clocks: argo hears of an overdue delivery within this of its clock running out. */
const OVERDUE_PASS_MS = 30_000;

/** How long core waits for pagasae's key set before it goes on with the keys it holds. */
const KEY_SET_FETCH_TIMEOUT_MS = 5_000;

/** Checks account tokens with the keys pagasae publishes at its `/.well-known/jwks.json`; none without an issuer. */
function accountTokenSignaturesOf(issuer: string | undefined, clock: Clock) {
  if (issuer === undefined) {
    return undefined;
  }
  const keySetUrl = `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
  return createAccountTokenSignatures({
    issuer,
    now: () => clock.now(),
    fetchKeySet: async () => {
      const response = await fetch(keySetUrl, { signal: AbortSignal.timeout(KEY_SET_FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        throw new Error(`pagasae answered ${String(response.status)} for its key set`);
      }
      return response.json();
    },
  });
}

/**
 * Wires adapters to use cases and returns the HTTP server, not yet listening.
 * The delivery listener starts at once and wakes waiting receives and live
 * subscriptions, and the 10 and 60 minute clocks and the stuck snapshot's
 * close pass every 30 seconds.
 * Closing the server also stops both and disconnects the database.
 */
export function createApp(options: AppOptions): FastifyInstance {
  const prisma = createPrismaClient(options.databaseUrl);
  const clock = options.clock ?? systemClock;
  const wakeups = createReceiverWakeups();
  const fleetEvents = createFleetEventWakeups();

  const useCases = createUseCases({
    prisma,
    clock,
    wakeups,
    fleetEventWakeups: fleetEventWakeupsOf(fleetEvents),
    receiveWaitMs: options.receiveWaitMs,
    accountTokenSignatures: accountTokenSignaturesOf(options.accountTokenIssuer, clock),
  });
  const server = buildHttpServer({
    useCases,
    fleetUrl: options.publicUrl,
    installationToken: options.installationToken,
    fleetEvents,
    checkDatabase: () => checkDatabase(prisma),
    latestMigration: () => latestMigration(prisma),
    clock,
    logger: options.logger,
    shouldTrustProxy: options.shouldTrustProxy,
    signInRateLimit: options.signInRateLimit,
    registerRateLimit: options.registerRateLimit,
    cookieDomain: options.cookieDomain,
    consoleOrigin: options.consoleOrigin ?? new URL(options.publicUrl).origin,
  });

  const listener = listenForPendingDeliveries({
    databaseUrl: options.databaseUrl,
    onNotice: (notice) => {
      wakeups.deliveryPending(notice);
    },
    onFleetEvent: (notice) => {
      fleetEvents.eventCommitted(notice);
    },
    onListening: () => {
      wakeups.wakeAll();
      fleetEvents.wakeAll();
    },
    onError: (error) => {
      server.log.warn(failureForLog(error), 'delivery listener lost its connection: listening again shortly');
    },
  });

  // One pass, every 30 seconds: the clocks, then the stuck snapshot's close.
  // Each failure is logged on its own, so one never keeps the other from running.
  const overduePasses = repeatPass({
    pass: async () => {
      await useCases.tellOverdueDeliveries().catch((error: unknown) => {
        server.log.warn(failureForLog(error), 'the 10 and 60 minute clocks failed a pass: passing again shortly');
      });
      await useCases.closeHealthSnapshots((fleetId, error) => {
        server.log.warn({ ...failureForLog(error), fleetId }, 'the stuck snapshot failed to close an hour for a fleet: closing it again next pass');
      });
    },
    everyMs: options.overduePassMs ?? OVERDUE_PASS_MS,
    onError: (error) => {
      server.log.warn(failureForLog(error), 'the stuck snapshot failed to close an hour: closing it again next pass');
    },
  });

  // Before the server stops taking requests and waits for the ones it holds:
  // a waiting receive answers no deliveries at once instead of holding it up,
  // and a live subscription ends.
  // Connections idle at that moment close at once (Fastify's default); one
  // whose request ends later is told to close with its answer, or it would
  // stay open, idle, until its keep-alive timeout.
  let isStopping = false;
  server.addHook('preClose', (done) => {
    isStopping = true;
    wakeups.endAll();
    fleetEvents.endAll();
    done();
  });
  server.addHook('onSend', async (_request, reply) => {
    if (isStopping) {
      void reply.header('connection', 'close');
    }
  });

  server.addHook('onClose', async () => {
    await overduePasses.stop();
    await listener.close();
    await prisma.$disconnect();
  });

  return server;
}
