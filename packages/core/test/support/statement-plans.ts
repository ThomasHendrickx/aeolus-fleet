import { z } from 'zod';

import { createPrismaClientTellingStatements, type PrismaClient } from '../../src/adapters/prisma/client.js';
import { createUseCases, type UseCases } from '../../src/wiring.js';
import type { PostgresCore } from './postgres-core.js';

/** A statement a read ran that names messages, deliveries or events, with the plan Postgres gives it on the fixture. */
export interface StatementPlan {
  statement: string;
  plan: string;
}

/** The history tables a plan test guards (holding scale, decision 2). */
const HISTORY_TABLE = /(?:"|\b)(messages|deliveries|events)(?:"|\b)/;
const SEQUENTIAL_SCAN = /Seq Scan on (messages|deliveries|events)\b/g;
/** Statements with no plan of their own: transaction control and settings. */
const PLANLESS = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET|DEALLOCATE|LISTEN|UNLISTEN|NOTIFY)\b/i;
const params = z.array(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]));

/** The sequential scans of messages, deliveries or events in a plan, by table. */
export function sequentialScansOf(plan: string): string[] {
  return [...plan.matchAll(SEQUENTIAL_SCAN)].map(([, table]) => table ?? '');
}

/**
 * Runs `read` on its own client and use cases over the fixture's database,
 * and answers each statement it ran on messages, deliveries or events with
 * its EXPLAIN, distinct by statement text. The plan is asserted, never a
 * time, which flakes under a loaded run (#1822).
 */
export async function plansOf(core: PostgresCore, read: (ports: { client: PrismaClient; useCases: UseCases }) => Promise<unknown>): Promise<StatementPlan[]> {
  const ran = new Map<string, string>();
  const client = createPrismaClientTellingStatements(core.databaseUrl, (statement, values) => {
    if (HISTORY_TABLE.test(statement) && !PLANLESS.test(statement) && !ran.has(statement)) {
      ran.set(statement, values);
    }
  });
  try {
    await read({ client, useCases: createUseCases({ prisma: client, clock: core.clock }) });
  } finally {
    await client.$disconnect();
  }
  const plans: StatementPlan[] = [];
  for (const [statement, values] of ran) {
    // The statement and its parameters come only from this client's query log.
    const rows = await core.prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>('EXPLAIN ' + statement, ...params.parse(JSON.parse(values)));
    plans.push({ statement, plan: rows.map((row) => row['QUERY PLAN']).join('\n') });
  }
  return plans;
}

/** The plans of `plansOf` that scan messages, deliveries or events sequentially, as `<table>` per scan: empty when the read holds. */
export function scansIn(plans: readonly StatementPlan[]): { statement: string; tables: string[] }[] {
  return plans.map(({ statement, plan }) => ({ statement, tables: sequentialScansOf(plan) })).filter(({ tables }) => tables.length > 0);
}
