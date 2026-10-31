import { expectationSetterSchema, idSchema, reportTaskSchema } from '@aeolus-fleet/common';

import type { Expectations, ShipExpectations } from '../../domain/registry/expectations.js';
import type { ExpectationsRepository } from '../../domain/registry/ports.js';
import type { Db } from './client.js';
import { Prisma } from './generated/client.js';

interface ExpectationsRow {
  fleetId: string;
  shipId: string;
  reportChangesWithinMinutes: number | null;
  reportChangesWithinSetBy: unknown;
  reportChangesWithinSetAt: Date | null;
  taskDoneByTask: unknown;
  taskDoneBy: Date | null;
  taskDoneBySetBy: unknown;
  taskDoneBySetAt: Date | null;
}

/** What a row holds, its setters and task parsed by common's schemas; an expectation whose columns are null is not set. */
export function shipExpectationsOf(row: ExpectationsRow): ShipExpectations {
  return {
    reportChangesWithin:
      row.reportChangesWithinMinutes === null || row.reportChangesWithinSetAt === null
        ? null
        : { minutes: row.reportChangesWithinMinutes, setBy: expectationSetterSchema.parse(row.reportChangesWithinSetBy), setAt: row.reportChangesWithinSetAt },
    taskDoneBy:
      row.taskDoneBy === null || row.taskDoneBySetAt === null
        ? null
        : { task: reportTaskSchema.parse(row.taskDoneByTask), doneBy: row.taskDoneBy, setBy: expectationSetterSchema.parse(row.taskDoneBySetBy), setAt: row.taskDoneBySetAt },
  };
}

/** The row's columns; DbNull: an expectation not set is SQL NULL, not the JSON value null. */
function columnsOf({ reportChangesWithin, taskDoneBy }: ShipExpectations) {
  return {
    reportChangesWithinMinutes: reportChangesWithin?.minutes ?? null,
    reportChangesWithinSetBy: reportChangesWithin?.setBy ?? Prisma.DbNull,
    reportChangesWithinSetAt: reportChangesWithin?.setAt ?? null,
    taskDoneByTask: taskDoneBy?.task ?? Prisma.DbNull,
    taskDoneBy: taskDoneBy?.doneBy ?? null,
    taskDoneBySetBy: taskDoneBy?.setBy ?? Prisma.DbNull,
    taskDoneBySetAt: taskDoneBy?.setAt ?? null,
  };
}

/** The expectations on ships on Postgres (decision 0071), one row per ship. */
export function createPrismaExpectationsRepository(db: Db): ExpectationsRepository {
  return {
    find: async (fleetId, shipId) => {
      const row = await db.shipExpectations.findUnique({ where: { fleetId_shipId: { fleetId, shipId } } });
      return row === null ? undefined : { fleetId: idSchema('fleet').parse(row.fleetId), shipId: idSchema('ship').parse(row.shipId), ...shipExpectationsOf(row) };
    },
    save: async (expectations: Expectations) => {
      const columns = columnsOf(expectations);
      await db.shipExpectations.upsert({
        where: { fleetId_shipId: { fleetId: expectations.fleetId, shipId: expectations.shipId } },
        create: { fleetId: expectations.fleetId, shipId: expectations.shipId, ...columns },
        update: columns,
      });
    },
    remove: async (fleetId, shipId) => {
      await db.shipExpectations.deleteMany({ where: { fleetId, shipId } });
    },
  };
}
