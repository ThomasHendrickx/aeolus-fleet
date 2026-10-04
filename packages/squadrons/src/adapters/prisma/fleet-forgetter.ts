import type { FleetForgetter } from '../../core/installation/ports.js';
import type { PrismaClient } from './client.js';

/**
 * Forgets every record squadrons holds of a fleet, in one transaction: its
 * repositories and their tokens, its squadrons with their members and kept
 * messages, its formation attempts, its connection, its switch and the
 * requests that name it. Members and formation ships go before what they
 * belong to.
 */
export function createPrismaFleetForgetter(db: PrismaClient): FleetForgetter {
  return {
    forget: async (fleetId) => {
      const where = { where: { fleetId } };
      await db.$transaction([
        db.member.deleteMany(where),
        db.flagshipMessage.deleteMany(where),
        db.squadron.deleteMany(where),
        db.formationShip.deleteMany(where),
        db.formationAttempt.deleteMany(where),
        db.templateRepository.deleteMany(where),
        db.managementCrew.deleteMany(where),
        db.fleetSwitch.deleteMany(where),
        db.installationRequest.deleteMany(where),
      ]);
    },
  };
}
