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
   * once. Only a wrong ship id or secret counts against the client's limit, so
   * one address can start many sessions (ADR 0015); a client over it is
   * refused before its secret is even checked.
   */
  register: publicProcedure
    .use(({ ctx, next }) => {
      if (!ctx.registerFailures.hasRoom(ctx.clientKey)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many failed register attempts. Wait a minute.' });
      }
      return next();
    })
    .input(registerInputSchema)
    .output(registerOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const claimed = await ctx.useCases.claimShip(input);
      if (!claimed.isOk && claimed.error.kind === 'WRONG_SHIP_ID_OR_SECRET') {
        ctx.registerFailures.count(ctx.clientKey);
      }
      return okOrThrow(claimed);
    }),

  /** The caller's ship: id, fleet, name and type. Any caller may ask about itself. */
  whoami: authenticatedProcedure
    .output(whoamiOutputSchema)
    .query(async ({ ctx }) => okOrThrow(await ctx.useCases.whoami(ctx.caller))),
});
