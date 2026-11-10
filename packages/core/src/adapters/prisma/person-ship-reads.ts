/** Narrow registry read ports bound to the same locked snapshot connection. */
import { idSchema, personShipRowSchema, PERSON_SHIP_PAGE_SIZE, type FleetId, type ShipReportsOutput } from '@aeolus-fleet/common';
import { HARBOUR_STATES } from '@aeolus-fleet/common/rules';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import type { PersonShipReadTx } from '../../domain/registry/person-ship-reads.js';
import type { Prisma } from './generated/client.js';
import { readPersonShipFacts } from './person-ship-facts.js';
import { personShipPageStatement } from './person-ship-page.js';
import { createPersonShipQuery } from './person-ship-query.js';
import { personShipReportsStatement } from './person-ship-reports.js';

const pageRowSchema = personShipRowSchema.extend({ sortName: z.string() });
const reportRowSchema = z.object({
  shipId: idSchema('ship'), isAvailable: z.boolean(), state: z.enum(HARBOUR_STATES), note: z.string().nullable(), lastActivityAt: z.date().nullable(),
});

export function createPrismaPersonShipReadTx(options: { connection: PoolClient; onStatement?: (statement: string) => void; onQuery?: (statement: Prisma.Sql) => void }): PersonShipReadTx {
  const query = createPersonShipQuery(options);
  const reports = async (fleetId: FleetId, read: Parameters<typeof personShipReportsStatement>[1]): Promise<ShipReportsOutput> => {
    if (read.shipIds.length === 0) { return { rows: [] }; }
    const rows = await query(personShipReportsStatement(fleetId, read), reportRowSchema);
    return { rows: rows.map(({ shipId, isAvailable, state, note, lastActivityAt }) => ({ shipId,
      report: isAvailable ? { status: 'read' as const, state, note, lastActivityAt: lastActivityAt?.toISOString() ?? null } : { status: 'unavailable' as const },
    })) };
  };
  return {
    facts: { find: (caller, read) => readPersonShipFacts(query, { caller, verbs: read?.verbs ?? ['read', 'send'] }) },
    projection: {
      page: async (fleetId, read) => {
        const rows = await query(personShipPageStatement(fleetId, read), pageRowSchema);
        return rows.map(({ sortName, ...row }) => ({ row, position: { name: sortName, shipId: row.shipId } }));
      },
      selectedReports: (fleetId, selected) => {
        if (selected.length > PERSON_SHIP_PAGE_SIZE) { throw new Error('Only the selected page may be enriched'); }
        return reports(fleetId, { permission: null, shipIds: selected.map(({ row }) => row.shipId) });
      },
      reports,
    },
  };
}
