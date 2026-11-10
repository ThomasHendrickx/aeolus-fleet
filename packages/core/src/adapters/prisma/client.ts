import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient, type Prisma } from './generated/client.js';

export type { PrismaClient } from './generated/client.js';

/** The client itself, or the client of one interactive transaction. Repositories take either. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * How long a call waits for a connection from the pool, in a transaction or
 * outside one (such as the crew-token lookup), before it is refused as busy
 * (fleet-busy.ts). The pool keeps pg's default size.
 */
const CONNECTION_WAIT_MS = 10_000;

/**
 * How long a call's transaction may run before Prisma rolls it back; the
 * call is then refused as busy too (fleet-busy.ts).
 */
export const TRANSACTION_TIME_MS = 5_000;

/**
 * How long a bulk operation's transaction may run instead: one whose work
 * grows with the fleet's history, such as a fleet delete, so it legitimately
 * runs past a call's time. Past this one it is refused as busy too.
 */
export const BULK_TRANSACTION_TIME_MS = 30_000;

interface ClientPool {
  pool: Pool;
  onStatement?: (statement: string) => void;
}

// Share one bounded pool and its shutdown with reads that must lock before BEGIN.
const clientPools = new WeakMap<PrismaClient, ClientPool>();

/** The existing client's pool, whose lifecycle remains Prisma's. */
export function prismaPoolOf(client: PrismaClient): ClientPool {
  const found = clientPools.get(client);
  if (found === undefined) {
    throw new Error('Person reads require a client from createPrismaClient');
  }
  return found;
}

/** Creates a Prisma client on a pg connection pool for the given database. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: CONNECTION_WAIT_MS });
  const client = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
    transactionOptions: { maxWait: CONNECTION_WAIT_MS, timeout: TRANSACTION_TIME_MS },
  });
  clientPools.set(client, { pool });
  return client;
}

/**
 * A client as createPrismaClient makes, that also hands each statement it
 * runs to `onStatement`: for a scale test that counts the statements a read
 * runs, which a time would not show without flaking.
 */
export function createPrismaClientTellingStatements(databaseUrl: string, onStatement: (statement: string) => void): PrismaClient {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: CONNECTION_WAIT_MS });
  const client = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
    transactionOptions: { maxWait: CONNECTION_WAIT_MS, timeout: TRANSACTION_TIME_MS },
    log: [{ emit: 'event', level: 'query' }],
  });
  clientPools.set(client, { pool, onStatement });
  client.$on('query', (event) => {
    onStatement(event.query);
  });
  return client;
}

/** Throws when the database cannot answer a trivial query. */
export async function checkDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

/** The latest migration applied to the database, by name; null before the first. */
export async function latestMigration(db: PrismaClient): Promise<string | null> {
  const [row] = await db.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY migration_name DESC
    LIMIT 1`;
  return row?.migration_name ?? null;
}
