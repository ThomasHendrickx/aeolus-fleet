import { registerInputSchema, registerOutputSchema, whoamiOutputSchema } from '@aeolus-fleet/common';
import { TRPCError } from '@trpc/server';

import { authenticatedProcedure, okOrThrow, publicProcedure, router } from './trpc.js';

/**
 * Ship procedures: the ship contract. `register` takes the ship's id and
 * secret and returns a crew token; every later call carries that token as
 * `Authorization: Bearer` (ADR 0015). REST and MCP will map onto these.
 */
export const shipRouter = router({
  /**
   * Claims the ship for the calling session, which reports where it runs. The
   * secret travels in the body, never as a bearer; the crew token comes back
   * once. Rate-limited per client address (ADR 0015).
   */
  register: publicProcedure
    .use(({ ctx, next }) => {
      if (!ctx.takeRegisterAttempt(ctx.clientKey)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many register attempts. Wait a minute.' });
      }
      return next();
    })
    .input(registerInputSchema)
    .output(registerOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.claimShip(input))),

  /** The caller's ship: id, fleet, name and type. Any caller may ask about itself. */
  whoami: authenticatedProcedure
    .output(whoamiOutputSchema)
    .query(async ({ ctx }) => okOrThrow(await ctx.useCases.whoami(ctx.caller))),
});
