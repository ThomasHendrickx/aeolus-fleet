import { pingOutputSchema, systemVersionOutputSchema } from '@aeolus-fleet/common';

import { router, scopedProcedure } from './trpc.js';

export const systemRouter = router({
  /**
   * Server time and fleet count: proves an authorised call reaches the database
   * and back. Needs fleet:read, like every read about the fleet.
   */
  ping: scopedProcedure('fleet:read')
    .output(pingOutputSchema)
    .query(async ({ ctx }) => {
      const { serverTime, fleetCount } = await ctx.useCases.ping();
      return { serverTime: serverTime.toISOString(), fleetCount };
    }),

  /**
   * The versions the server process runs and its database's latest migration,
   * for the console's /version to a signed-in operator (#478). Needs
   * fleet:manage: the operator holds it, the viewer does not. Never asked
   * without a caller, unlike `/api/version`.
   */
  version: scopedProcedure('fleet:manage')
    .output(systemVersionOutputSchema)
    .query(({ ctx }) => ctx.readVersion()),
});
