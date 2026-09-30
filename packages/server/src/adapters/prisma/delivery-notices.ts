/**
 * Wakes receivers with Postgres LISTEN/NOTIFY (ADR 0003). A send notifies on
 * one channel inside its transaction; Postgres hands the notice to listeners
 * only when that transaction commits, and drops it when it rolls back. The
 * payload says which delivery is pending and for whom, never the message's
 * payload.
 */
import pg from 'pg';

import type { DeliveryNotice, Notifier } from '../../core/shared/notifier.js';
import type { Db } from './client.js';
import { toDeliveryNotice } from './rows.js';

/** The one channel every pending delivery is announced on. */
export const DELIVERY_PENDING_CHANNEL = 'aeolus_delivery_pending';

export function createPrismaNotifier(db: Db): Notifier {
  return {
    deliveryPending: async (notice) => {
      await db.$executeRaw`SELECT pg_notify(${DELIVERY_PENDING_CHANNEL}, ${JSON.stringify(notice)})`;
    },
  };
}

/** How the listener names its connection in Postgres (`application_name`), so it can be found there. */
export const LISTENER_APPLICATION_NAME = 'aeolus-delivery-listener';

/** The first wait before the listener tries again after losing its connection; each failure doubles it. */
const RECONNECT_DELAY_MS = 1_000;

/** The longest wait between two tries. */
const RECONNECT_DELAY_MAX_MS = 30_000;

export interface DeliveryListener {
  /** Settles once the listener first listens: notices of later commits reach it. */
  listening: Promise<void>;
  close(): Promise<void>;
}

/**
 * Listens for pending deliveries on a connection of its own: LISTEN needs one
 * that no pool hands to another query, and it must be direct, not through a
 * transaction pooler. Waiting receives are woken through it. Returns at once.
 *
 * It never throws: a failed connect or a lost connection goes to `onError`,
 * and it tries again after a delay that doubles with each failure, up to 30
 * seconds. Notices sent while it did not listen are gone, so `onListening`
 * runs each time it starts listening, for the waiting receives to look again.
 */
export function listenForPendingDeliveries(options: {
  databaseUrl: string;
  onNotice: (notice: DeliveryNotice) => void;
  onListening?: () => void;
  onError?: (error: Error) => void;
  /** The first wait before trying again; 1 second unless a test says otherwise. */
  reconnectDelayMs?: number;
}): DeliveryListener {
  const firstDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  const listening = Promise.withResolvers<undefined>();
  const report = (error: unknown) => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  let current: pg.Client | undefined;
  let retry: NodeJS.Timeout | undefined;
  let delayMs = firstDelayMs;
  let isClosed = false;

  /** Gives up a client that failed and tries again later: once per client, and never after close. */
  const tryAgainLater = (failed: pg.Client) => {
    if (isClosed || failed !== current) {
      return;
    }
    current = undefined;
    failed.end().catch(() => undefined);
    retry = setTimeout(connect, delayMs);
    delayMs = Math.min(delayMs * 2, RECONNECT_DELAY_MAX_MS);
  };

  const connect = () => {
    retry = undefined;
    const client = new pg.Client({ connectionString: options.databaseUrl, application_name: LISTENER_APPLICATION_NAME });
    current = client;
    client.on('error', (error) => {
      report(error);
      tryAgainLater(client);
    });
    client.on('end', () => {
      tryAgainLater(client);
    });
    client.on('notification', ({ channel, payload }) => {
      if (channel !== DELIVERY_PENDING_CHANNEL || payload === undefined) {
        return;
      }
      try {
        options.onNotice(toDeliveryNotice(JSON.parse(payload)));
      } catch (error) {
        report(error);
      }
    });
    client
      .connect()
      // The channel is the constant above, never outside input.
      .then(() => client.query(`LISTEN ${DELIVERY_PENDING_CHANNEL}`))
      .then(
        () => {
          if (client !== current) {
            return;
          }
          delayMs = firstDelayMs;
          listening.resolve(undefined);
          options.onListening?.();
        },
        (error: unknown) => {
          report(error);
          tryAgainLater(client);
        },
      );
  };

  connect();
  return {
    listening: listening.promise,
    close: async () => {
      isClosed = true;
      clearTimeout(retry);
      const client = current;
      current = undefined;
      await client?.end().catch(() => undefined);
    },
  };
}
