import { pingOutputSchema } from '@aeolus-fleet/common';

import { publicProcedure, router } from './trpc.js';

export const systemRouter = router({
  /** Server time and fleet count: proves one request reaches the database and back. */
  ping: publicProcedure.output(pingOutputSchema).query(async ({ ctx }) => {
    const { serverTime, fleetCount } = await ctx.useCases.ping();
    return { serverTime: serverTime.toISOString(), fleetCount };
  }),
});
