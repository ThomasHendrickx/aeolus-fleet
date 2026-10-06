import { pingOutputSchema } from '@aeolus-fleet/common';

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
});
