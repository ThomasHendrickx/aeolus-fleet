import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client.js';

export type { PrismaClient } from './generated/client.js';

/** Creates a Prisma client on a pg connection pool for the given database. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/** Throws when the database cannot answer a trivial query. */
export async function checkDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
