import { systemRouter } from './system.js';
import { router } from './trpc.js';

/** The single API door (ADR 0004). REST and MCP will map onto these procedures. */
export const appRouter = router({
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
