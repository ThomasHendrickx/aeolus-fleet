import type { FleetCounter } from '../../core/shared/ping.js';
import type { PrismaClient } from './client.js';

export function createPrismaFleetCounter(prisma: PrismaClient): FleetCounter {
  return {
    countFleets: () => prisma.fleet.count(),
  };
}
