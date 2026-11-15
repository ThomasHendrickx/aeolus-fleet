/** EXPLAIN without executing the read; JSON retains relations beneath joins and parallel nodes. */
import { expect } from 'vitest';
import { z } from 'zod';

import type { Db } from '../../src/adapters/prisma/client.js';
import { Prisma } from '../../src/adapters/prisma/generated/client.js';

const planNode = z.object({
  'Node Type': z.string(),
  'Relation Name': z.string().optional(),
  Plans: z.array(z.unknown()).optional(),
});
const historyTables = new Set(['messages', 'deliveries', 'events']);

function historyScans(value: unknown): string[] {
  const node = planNode.parse(value);
  const relation = node['Relation Name'];
  const scans = relation !== undefined && historyTables.has(relation) && node['Node Type'].includes('Seq Scan')
    ? [`${node['Node Type']} on ${relation}`] : [];
  return [...scans, ...(node.Plans ?? []).flatMap(historyScans)];
}

/** Accepts a parameterised statement or a query/params pair from Prisma's query log. Returns the plan for stricter assertions. */
export async function assertIndexedPlan(db: Db, statement: Prisma.Sql | { query: string; params: string }): Promise<string> {
  const result: unknown = 'query' in statement
    // Only SQL captured from this test client's query log belongs here, never outside input.
    ? await db.$queryRawUnsafe('EXPLAIN (FORMAT JSON) ' + statement.query,
      ...z.array(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())])).parse(JSON.parse(statement.params)))
    : await db.$queryRaw(Prisma.sql`EXPLAIN (FORMAT JSON) ${statement}`);
  const rows = z.array(z.object({ 'QUERY PLAN': z.array(z.object({ Plan: z.unknown() })) })).parse(result);
  const scans = rows.flatMap((row) => row['QUERY PLAN'].flatMap((entry) => historyScans(entry.Plan)));
  expect(scans, JSON.stringify(result, null, 2)).toEqual([]);
  return JSON.stringify(result, null, 2);
}
