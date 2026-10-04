import { consoleRouter } from './console.js';
import { fleetRouter } from './fleet.js';
import { installationRouter } from './installation.js';
import { shipRouter } from './ship.js';
import { systemRouter } from './system.js';
import { router } from './trpc.js';

/** The single API door (ADR 0004). REST and MCP map onto its ship procedures (ship-contract.ts). */
export const appRouter = router({
  console: consoleRouter,
  fleet: fleetRouter,
  installation: installationRouter,
  ship: shipRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
