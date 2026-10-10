import { PrismaPg } from '@prisma/adapter-pg';

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

/** Creates a Prisma client on a pg connection pool for the given database. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: CONNECTION_WAIT_MS }),
    transactionOptions: { maxWait: CONNECTION_WAIT_MS },
  });
}

/** Throws when the database cannot answer a trivial query. */
export async function checkDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
