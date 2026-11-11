/** The release step's rule-match build on its own client, as `aeolus-core migrate` and `start` run it after the migrations. */
import { createBuildRuleMatches } from '../../domain/registry/build-rule-matches.js';
import { createPrismaClient } from './client.js';
import { createPrismaBulkUnitOfWork } from './unit-of-work.js';

export async function buildRuleMatchesOf(databaseUrl: string): Promise<void> {
  const prisma = createPrismaClient(databaseUrl);
  try {
    await createBuildRuleMatches({ uow: createPrismaBulkUnitOfWork(prisma) })();
  } finally {
    await prisma.$disconnect();
  }
}
