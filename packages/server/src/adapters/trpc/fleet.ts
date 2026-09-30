import {
  commissionShipInputSchema,
  fleetListOutputSchema,
  getStartingPromptInputSchema,
  releaseShipInputSchema,
  releaseShipOutputSchema,
  startingPromptOutputSchema,
} from '@aeolus-fleet/common';

import { okOrThrow, router, scopedProcedure } from './trpc.js';

/**
 * Fleet procedures: commission ships, hand out their starting prompts, release
 * them, list the fleet. The caller's fleet and ship come from its credentials, never from
 * the input.
 */
export const fleetRouter = router({
  /** A new agent ship awaiting crew, and its first starting prompt: shown once. */
  commission: scopedProcedure('fleet:manage')
    .input(commissionShipInputSchema)
    .output(startingPromptOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.commissionShip(ctx.caller, input))),

  /** A new starting prompt for a ship awaiting crew. Its secret invalidates the previous one. */
  getStartingPrompt: scopedProcedure('fleet:manage')
    .input(getStartingPromptInputSchema)
    .output(startingPromptOutputSchema)
    .mutation(async ({ ctx, input }) => okOrThrow(await ctx.useCases.getStartingPrompt(ctx.caller, input))),

  /**
   * Frees a crewed ship from the session crewing it: its crew token and secret
   * stop working, and what it held in flight returns to pending for the next
   * crew. Never argo; a ship awaiting crew gets a new starting prompt instead.
   */
  release: scopedProcedure('fleet:manage')
    .input(releaseShipInputSchema)
    .output(releaseShipOutputSchema)
    .mutation(async ({ ctx, input }) => {
      okOrThrow(await ctx.useCases.releaseShip(ctx.caller, input));
      return {};
    }),

  /** Every ship of the caller's fleet with its status and prompt state. Never a secret. */
  list: scopedProcedure('fleet:read')
    .output(fleetListOutputSchema)
    .query(async ({ ctx }) =>
      (await ctx.useCases.listFleet(ctx.caller)).map((ship) => ({
        ...ship,
        startingPrompt: ship.startingPrompt && {
          issuedAt: ship.startingPrompt.issuedAt.toISOString(),
          isClaimed: ship.startingPrompt.isClaimed,
        },
      })),
    ),
});
