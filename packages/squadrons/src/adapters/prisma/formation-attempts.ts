import { idSchema } from '@aeolus-fleet/common';

import type { FormationAttempts } from '../../core/squadron/ports.js';
import type { Db } from './client.js';

/** Formation attempts in squadrons' database. Finishing one marks it, so it is kept for the record. */
export function createPrismaFormationAttempts(db: Db, clock: { now(): Date }): FormationAttempts {
  return {
    begin: async ({ id, fleetId, squadronId, startedAt }) => {
      await db.formationAttempt.create({ data: { id, fleetId, squadronId, startedAt } });
    },
    plan: async (attemptId, name) => {
      const attempt = await db.formationAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { fleetId: true, _count: { select: { ships: true } } } });
      await db.formationShip.create({ data: { attemptId, name, fleetId: attempt.fleetId, position: attempt._count.ships } });
    },
    commissioned: async (attemptId, { name, shipId }) => {
      await db.formationShip.update({ where: { attemptId_name: { attemptId, name } }, data: { shipId } });
    },
    finish: async (attemptId) => {
      await db.formationAttempt.updateMany({ where: { id: attemptId, finishedAt: null }, data: { finishedAt: clock.now() } });
    },
    unfinished: async (fleetId) =>
      (
        await db.formationAttempt.findMany({
          where: { fleetId, finishedAt: null },
          include: { ships: { orderBy: { position: 'asc' } } },
          orderBy: { startedAt: 'asc' },
        })
      ).map((attempt) => ({
        id: attempt.id,
        fleetId: idSchema('fleet').parse(attempt.fleetId),
        squadronId: attempt.squadronId,
        startedAt: attempt.startedAt,
        ships: attempt.ships.map((ship) => ({ name: ship.name, shipId: ship.shipId === null ? null : idSchema('ship').parse(ship.shipId) })),
      })),
  };
}
