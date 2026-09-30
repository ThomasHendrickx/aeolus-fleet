/**
 * Wakes receivers with Postgres LISTEN/NOTIFY (ADR 0003). A send notifies on
 * one channel inside its transaction; Postgres hands the notice to listeners
 * only when that transaction commits, and drops it when it rolls back. The
 * payload says which delivery is pending and for whom, never the message's
 * payload.
 */
import pg from 'pg';

import type { DeliveryNotice, Notifier } from '../../core/messaging/ports.js';
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

export interface DeliveryListener {
  /** Settles once the listener first listens: notices of later commits reach it. */
  listening: Promise<void>;
  close(): Promise<void>;
}

/**
 * Listens for pending deliveries on a connection of its own: LISTEN needs one
 * that no pool hands to another query, and it must be direct, not through a
 * transaction pooler. Waiting receives are woken through it. Returns at once;
 * `onListening` runs each time it starts listening.
 */
export function listenForPendingDeliveries(options: {
  databaseUrl: string;
  onNotice: (notice: DeliveryNotice) => void;
  onListening?: () => void;
}): DeliveryListener {
  const listening = Promise.withResolvers<undefined>();
  const client = new pg.Client({ connectionString: options.databaseUrl });
  client.on('notification', ({ channel, payload }) => {
    if (channel === DELIVERY_PENDING_CHANNEL && payload !== undefined) {
      options.onNotice(toDeliveryNotice(JSON.parse(payload)));
    }
  });
  const started = (async () => {
    await client.connect();
    // The channel is the constant above, never outside input.
    await client.query(`LISTEN ${DELIVERY_PENDING_CHANNEL}`);
    listening.resolve(undefined);
    options.onListening?.();
  })();
  started.catch((error: unknown) => {
    listening.reject(error);
  });
  return {
    listening: listening.promise,
    close: async () => {
      await started.catch(() => undefined);
      await client.end();
    },
  };
}
